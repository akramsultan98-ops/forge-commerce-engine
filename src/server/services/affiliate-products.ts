// Affiliate products: network listings (e.g. Amazon.eg ASINs) that move through review before they
// reach the storefront. Network-agnostic — providers (src/server/affiliate) and n8n call the same
// functions, so every network shares one data model, one lifecycle and one API.

import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, not, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { AFFILIATE_AVAILABILITY, AFFILIATE_NETWORK_TYPES, AFFILIATE_PRODUCT_STATUSES, PUBLIC_PRODUCT_STATUSES, type AffiliateNetworkType, type AffiliateProductStatus, type Provenance } from "@/lib/constants";
import { can } from "@/lib/rbac";
import {
  ACTION_PERMISSION,
  AFFILIATE_ACTIONS,
  HUMAN_ONLY_ACTIONS,
  LISTING_EDITABLE_FIELDS,
  MACHINE_EDITABLE_STATUSES,
  allowedActions,
  dataAgeHours,
  isDataFresh,
  nextStatus,
  publishBlockers,
  type AffiliateAction,
} from "@/domain/affiliate-products";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { affiliateLinks, affiliateProducts, categories, products, type AffiliateProduct } from "../db/schema";
import { audit } from "../audit";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { AFFILIATE_PROVIDERS, getAffiliateProvider } from "../affiliate/registry";
import type { AffiliateProvider } from "../affiliate/types";
import { trackedUrl } from "./affiliate";
import { publishToStorefront, syncStorefrontProduct, takeDownFromStorefront } from "./affiliate-publishing";

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => u.startsWith("https://"), "must be an https:// URL");
const opt = <T extends z.ZodTypeAny>(s: T) => s.nullable().optional();

/** Validation for everything that enters FORGE — provider results and n8n/API payloads alike. */
export const AffiliateProductInputSchema = z
  .object({
    network: z.enum(AFFILIATE_NETWORK_TYPES),
    marketplace: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9.-]{3,60}$/, "marketplace host, e.g. www.amazon.eg"),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 country code"),
    externalId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,64}$/, "ASIN or network product id"),
    externalIdType: z
      .string()
      .trim()
      .regex(/^[A-Z_]{2,20}$/)
      .optional(),
    parentExternalId: opt(z.string().trim().max(64)),
    merchant: opt(z.string().trim().max(120)),
    title: z.string().trim().min(1).max(500),
    description: opt(z.string().trim().max(5000)),
    features: z.array(z.string().trim().max(500)).max(20).optional(),
    category: opt(z.string().trim().max(200)),
    categoryPath: z.array(z.string().trim().max(120)).max(10).optional(),
    brand: opt(z.string().trim().max(120)),
    productUrl: opt(httpsUrl),
    affiliateUrl: opt(httpsUrl),
    imageUrls: z.array(httpsUrl).max(10).optional(),
    price: opt(z.number().min(0).max(100_000_000)),
    currency: opt(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/),
    ),
    priceDisplay: opt(z.string().trim().max(40)),
    availability: z.enum(AFFILIATE_AVAILABILITY).optional(),
    availabilityMessage: opt(z.string().trim().max(300)),
    rating: opt(z.number().min(0).max(5)),
    reviewCount: opt(z.number().int().min(0)),
    reviewSource: opt(z.string().trim().max(120)),
    commissionRate: opt(z.number().min(0).max(100)),
    networkMeta: z
      .record(z.string(), z.unknown())
      .refine((m) => JSON.stringify(m).length <= 10_000, "networkMeta is larger than 10 KB")
      .optional(),
    fetchedAt: z.coerce.date().optional(),
    provenance: z.enum(["REAL", "MANUAL"]).optional(),
  })
  .refine((d) => (d.rating == null && d.reviewCount == null) || !!d.reviewSource, {
    message: "rating/reviewCount need reviewSource — only store review data the network legitimately supplies",
    path: ["reviewSource"],
  })
  .refine((d) => d.price == null || !!d.currency, { message: "a price needs a currency", path: ["currency"] });

/** Fields the network supplies. They change only through ingest/refresh — never through a FORGE edit. */
const NETWORK_FIELDS = new Set([...Object.keys(AffiliateProductInputSchema.shape), "dataFetchedAt", "lastSyncError", "networkId", "ingestSource"]);

export type IngestSource = "provider" | "n8n" | "api" | "manual";

export interface IngestResult {
  created: number;
  updated: number;
  /** Published listings whose storefront product was rewritten with the new data. */
  synced: number;
  items: Array<{ id: string; externalId: string; marketplace: string; status: AffiliateProductStatus; created: boolean }>;
  errors: Array<{ index: number; externalId?: string; message: string }>;
}

const defined = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
const txContext = (ctx: ServiceContext, tx: unknown): ServiceContext => ({ ...ctx, db: tx as Database });

/**
 * Upserts listings by (network, marketplace, externalId). New listings start as DISCOVERED; existing
 * ones get fresh network data while their review state and FORGE-owned fields are left alone.
 * Published listings also refresh their storefront product.
 */
export async function ingestAffiliateProducts(ctx: ServiceContext, inputs: unknown[], opts: { source: IngestSource; provenance: Provenance }): Promise<IngestResult> {
  assertCan(ctx, "affiliate:ingest");
  const result: IngestResult = { created: 0, updated: 0, synced: 0, items: [], errors: [] };
  for (const [index, raw] of inputs.entries()) {
    const parsed = AffiliateProductInputSchema.safeParse(raw);
    if (!parsed.success) {
      const externalId = (raw as { externalId?: unknown } | null)?.externalId;
      result.errors.push({ index, externalId: typeof externalId === "string" ? externalId.slice(0, 64) : undefined, message: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") });
      continue;
    }
    const d = parsed.data;
    const data = defined({
      country: d.country,
      parentExternalId: d.parentExternalId,
      merchant: d.merchant,
      title: d.title,
      description: d.description,
      features: d.features,
      category: d.category,
      categoryPath: d.categoryPath,
      brand: d.brand,
      productUrl: d.productUrl,
      affiliateUrl: d.affiliateUrl,
      imageUrls: d.imageUrls,
      price: d.price,
      currency: d.currency,
      priceDisplay: d.priceDisplay,
      availability: d.availability,
      availabilityMessage: d.availabilityMessage,
      rating: d.rating,
      reviewCount: d.reviewCount,
      reviewSource: d.reviewSource,
      commissionRate: d.commissionRate,
      networkMeta: d.networkMeta,
      provenance: d.provenance ?? opts.provenance,
      dataFetchedAt: d.fetchedAt ?? new Date(),
      lastSyncError: null,
    });
    const key = and(eq(affiliateProducts.organizationId, ctx.orgId), eq(affiliateProducts.network, d.network), eq(affiliateProducts.marketplace, d.marketplace), eq(affiliateProducts.externalId, d.externalId));
    const [existing] = await ctx.db.select({ id: affiliateProducts.id }).from(affiliateProducts).where(key).limit(1);
    if (existing) {
      const [row] = await ctx.db.update(affiliateProducts).set({ ...data, updatedAt: new Date() }).where(eq(affiliateProducts.id, existing.id)).returning();
      if (await syncStorefrontProduct(ctx, row)) result.synced++;
      result.updated++;
      result.items.push({ id: row.id, externalId: d.externalId, marketplace: d.marketplace, status: row.status, created: false });
      continue;
    }
    const [row] = await ctx.db
      .insert(affiliateProducts)
      .values({
        organizationId: ctx.orgId,
        network: d.network,
        marketplace: d.marketplace,
        externalId: d.externalId,
        externalIdType: d.externalIdType ?? getAffiliateProvider(d.network)?.externalIdType ?? "ID",
        ingestSource: opts.source,
        ...data,
        country: d.country,
        title: d.title,
      })
      .onConflictDoUpdate({ target: [affiliateProducts.organizationId, affiliateProducts.network, affiliateProducts.marketplace, affiliateProducts.externalId], set: { ...data, updatedAt: new Date() } })
      .returning({ id: affiliateProducts.id, status: affiliateProducts.status });
    result.created++;
    result.items.push({ id: row.id, externalId: d.externalId, marketplace: d.marketplace, status: row.status, created: true });
  }
  if (result.created || result.updated) await audit(ctx, "affiliate_products.ingest", { type: "affiliate_product" }, { source: opts.source, created: result.created, updated: result.updated, synced: result.synced, errors: result.errors.length });
  return result;
}

export type AffiliateProductView = AffiliateProduct & {
  dataAgeHours: number | null;
  fresh: boolean;
  maxDataAgeHours: number | null;
  allowedActions: AffiliateAction[];
  /** Why the listing could not be published right now (empty once published, rejected or archived). */
  publishBlockers: string[];
};

function view(row: AffiliateProduct, now = new Date()): AffiliateProductView {
  const max = getAffiliateProvider(row.network)?.maxDataAgeHours ?? null;
  const age = dataAgeHours(row.dataFetchedAt, now);
  const reviewable = row.status === "DISCOVERED" || row.status === "REVIEW" || row.status === "APPROVED";
  return {
    ...row,
    dataAgeHours: age === null ? null : Math.round(age * 10) / 10,
    fresh: isDataFresh(row.dataFetchedAt, max, now),
    maxDataAgeHours: max,
    allowedActions: allowedActions(row.status),
    publishBlockers: reviewable ? publishBlockers(row, max, now) : [],
  };
}

/** Listings whose network data is older than that network's limit (networks without a limit are never stale). */
function staleCondition(now = new Date()): SQL {
  const rules = AFFILIATE_PROVIDERS.filter((p) => p.maxDataAgeHours !== null).map(
    (p) => and(eq(affiliateProducts.network, p.network), or(isNull(affiliateProducts.dataFetchedAt), lt(affiliateProducts.dataFetchedAt, new Date(now.getTime() - p.maxDataAgeHours! * 3_600_000))))!,
  );
  return rules.length ? or(...rules)! : sql`false`;
}

export interface AffiliateProductQuery {
  status?: AffiliateProductStatus;
  network?: AffiliateNetworkType;
  marketplace?: string;
  stale?: boolean;
  /** Only listings whose last refresh or a reported check failed. */
  hasError?: boolean;
  q?: string;
  /** Incremental sync for automations: listings changed at or after this time. */
  updatedSince?: Date;
  sort?: "updated" | "score" | "fetched";
  limit?: number;
  offset?: number;
}

export async function listAffiliateProducts(ctx: ServiceContext, q: AffiliateProductQuery = {}) {
  assertCan(ctx, "affiliate:read");
  const limit = Math.min(200, Math.max(1, q.limit ?? 50));
  const offset = Math.max(0, q.offset ?? 0);
  const conds: Array<SQL | undefined> = [eq(affiliateProducts.organizationId, ctx.orgId)];
  if (q.status) conds.push(eq(affiliateProducts.status, q.status));
  if (q.network) conds.push(eq(affiliateProducts.network, q.network));
  if (q.marketplace) conds.push(eq(affiliateProducts.marketplace, q.marketplace.toLowerCase()));
  if (q.stale === true) conds.push(staleCondition());
  if (q.stale === false) conds.push(not(staleCondition()));
  if (q.hasError === true) conds.push(isNotNull(affiliateProducts.lastSyncError));
  if (q.hasError === false) conds.push(isNull(affiliateProducts.lastSyncError));
  if (q.updatedSince) conds.push(gte(affiliateProducts.updatedAt, q.updatedSince));
  if (q.q?.trim()) {
    const term = `%${q.q.trim().slice(0, 100).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(affiliateProducts.title, term), ilike(affiliateProducts.externalId, term), ilike(affiliateProducts.brand, term)));
  }
  const where = and(...conds);
  const order =
    q.sort === "score"
      ? [desc(sql`coalesce(${affiliateProducts.score}, -1)`), desc(affiliateProducts.updatedAt)]
      : q.sort === "fetched"
        ? [sql`${affiliateProducts.dataFetchedAt} asc nulls first`]
        : [desc(affiliateProducts.updatedAt)];
  const rows = await ctx.db.select().from(affiliateProducts).where(where).orderBy(...order).limit(limit).offset(offset);
  const [{ total }] = await ctx.db.select({ total: count() }).from(affiliateProducts).where(where);
  return { items: rows.map((r) => view(r)), total: Number(total), limit, offset };
}

export async function affiliateStatusCounts(ctx: ServiceContext): Promise<Record<AffiliateProductStatus, number>> {
  assertCan(ctx, "affiliate:read");
  const rows = await ctx.db.select({ status: affiliateProducts.status, n: count() }).from(affiliateProducts).where(eq(affiliateProducts.organizationId, ctx.orgId)).groupBy(affiliateProducts.status);
  const out = Object.fromEntries(AFFILIATE_PRODUCT_STATUSES.map((s) => [s, 0])) as Record<AffiliateProductStatus, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

async function getRow(ctx: ServiceContext, id: string): Promise<AffiliateProduct> {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Affiliate product");
  const [row] = await ctx.db.select().from(affiliateProducts).where(and(eq(affiliateProducts.id, id), eq(affiliateProducts.organizationId, ctx.orgId))).limit(1);
  if (!row) throw new NotFoundError("Affiliate product");
  return row;
}

export interface ListingStorefront {
  productId: string;
  slug: string;
  path: string;
  productStatus: string;
  available: boolean;
  /** On the storefront right now: a public status and network data that has not expired. */
  visible: boolean;
  expiresAt: Date | null;
  link: { id: string; code: string; status: string; trackedUrl: string } | null;
}

async function storefrontOf(ctx: ServiceContext, row: AffiliateProduct): Promise<ListingStorefront | null> {
  if (!row.productId) return null;
  const [p] = await ctx.db
    .select({ id: products.id, slug: products.slug, status: products.status, available: products.available, expiresAt: products.externalDataExpiresAt })
    .from(products)
    .where(and(eq(products.id, row.productId), eq(products.organizationId, ctx.orgId)))
    .limit(1);
  if (!p) return null;
  const [link] = await ctx.db.select({ id: affiliateLinks.id, code: affiliateLinks.code, status: affiliateLinks.status }).from(affiliateLinks).where(eq(affiliateLinks.affiliateProductId, row.id)).orderBy(desc(affiliateLinks.isPrimary)).limit(1);
  return {
    productId: p.id,
    slug: p.slug,
    path: `/products/${p.slug}`,
    productStatus: p.status,
    available: p.available,
    visible: PUBLIC_PRODUCT_STATUSES.includes(p.status) && (!p.expiresAt || p.expiresAt > new Date()),
    expiresAt: p.expiresAt,
    link: link ? { ...link, trackedUrl: trackedUrl(link.code) } : null,
  };
}

export type AffiliateProductDetail = AffiliateProductView & { storefront: ListingStorefront | null };

export async function getAffiliateProduct(ctx: ServiceContext, id: string): Promise<AffiliateProductDetail> {
  assertCan(ctx, "affiliate:read");
  const row = await getRow(ctx, id);
  return { ...view(row), storefront: await storefrontOf(ctx, row) };
}

/**
 * Moves a listing through its review lifecycle. Guarded by permission (machines prepare, people
 * decide), by the transition table, by publishing rules, and against concurrent edits (status and
 * revision must still be what the caller saw). Publishing puts the product on the storefront;
 * unpublishing and archiving take it down — in the same transaction.
 */
export async function transitionAffiliateProduct(ctx: ServiceContext, id: string, action: string, note?: string | null, opts: { expectedRevision?: number } = {}): Promise<AffiliateProductView> {
  if (!(AFFILIATE_ACTIONS as readonly string[]).includes(action)) throw new ValidationError(`Unknown action "${action}" — use one of: ${AFFILIATE_ACTIONS.join(", ")}`);
  const a = action as AffiliateAction;
  assertCan(ctx, ACTION_PERMISSION[a]);
  if (HUMAN_ONLY_ACTIONS.includes(a) && ctx.actor !== "user" && ctx.actor !== "system") {
    throw new ForbiddenError(`"${a}" must be done by a signed-in person — API keys and automations can prepare listings but not ${a === "approve" ? "approve" : "publish"} them`);
  }
  const row = await getRow(ctx, id);
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== row.revision) throw new ConflictError(`The listing changed since you loaded it (revision ${opts.expectedRevision}, now ${row.revision}) — reload and try again`);
  const to = nextStatus(row.status, a);
  if (!to) throw new ConflictError(`Cannot ${a} a ${row.status} product (allowed: ${allowedActions(row.status).join(", ") || "none"})`);
  if (a === "publish") {
    const blockers = publishBlockers(row, getAffiliateProvider(row.network)?.maxDataAgeHours ?? null);
    if (blockers.length) throw new ValidationError(`Cannot publish yet: ${blockers.join("; ")}`, { blockers });
  }
  const reviewed = a === "approve" || a === "reject";
  const now = new Date();
  const updated = await ctx.db.transaction(async (tx) => {
    const tctx = txContext(ctx, tx);
    const [u] = await tx
      .update(affiliateProducts)
      .set({
        status: to,
        statusChangedAt: now,
        updatedAt: now,
        revision: sql`${affiliateProducts.revision} + 1`,
        ...(reviewed ? { reviewedBy: ctx.userId } : {}),
        ...(note ? { reviewNote: note.slice(0, 2000) } : {}),
        ...(a === "publish" ? { publishedAt: now } : {}),
      })
      .where(and(eq(affiliateProducts.id, id), eq(affiliateProducts.organizationId, ctx.orgId), eq(affiliateProducts.status, row.status), eq(affiliateProducts.revision, row.revision)))
      .returning();
    if (!u) throw new ConflictError("The listing changed while it was being reviewed — reload and try again");
    if (a === "publish") return publishToStorefront(tctx, u);
    if (a === "unpublish") await takeDownFromStorefront(tctx, u, "PAUSED");
    if (a === "archive" && (row.status === "PUBLISHED" || u.productId)) await takeDownFromStorefront(tctx, u, "ARCHIVED");
    return u;
  });
  await audit(ctx, `affiliate_product.${a}`, { type: "affiliate_product", id }, { from: row.status, to, note: note ?? null, productId: updated.productId });
  return view(updated);
}

const blank = (v: unknown) => (typeof v === "string" && !v.trim() ? null : v);
const EditSchema = z.object({
  categoryId: z.preprocess(blank, z.string().uuid().nullable()).optional(),
  summary: z.preprocess(blank, z.string().trim().max(2000).nullable()).optional(),
  problemSolved: z.preprocess(blank, z.string().trim().max(300).nullable()).optional(),
  targetAudience: z.preprocess(blank, z.string().trim().max(300).nullable()).optional(),
  tags: z
    .preprocess(
      (v) =>
        typeof v === "string"
          ? v
              .split(/\n|,/)
              .map((s) => s.trim())
              .filter(Boolean)
          : v,
      z.array(z.string().trim().min(1).max(60)).max(20),
    )
    .optional(),
  expectedCommissionRate: z.preprocess((v) => (v === "" || v === null ? null : typeof v === "string" ? Number(v) : v), z.number().min(0).max(100).nullable()).optional(),
});

/**
 * Edits FORGE-owned fields (category, summary, problem, audience, tags, expected commission). Network
 * fields are refused — they change only through a refresh. People edit any time; automations only
 * before review. `expectedRevision` must match (concurrent-edit protection). Published listings update
 * their storefront product in the same transaction.
 */
export async function updateAffiliateProduct(ctx: ServiceContext, id: string, raw: unknown, expectedRevision: number): Promise<AffiliateProductView> {
  if (!can(ctx.role, "affiliate:review") && !can(ctx.role, "affiliate:ingest")) throw new ForbiddenError(`Your role (${ctx.role}) cannot edit listings`);
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const networkOwned = Object.keys(input).filter((k) => NETWORK_FIELDS.has(k));
  if (networkOwned.length) throw new ValidationError(`${networkOwned.join(", ")} ${networkOwned.length === 1 ? "is" : "are"} supplied by the network and cannot be edited in FORGE — refresh the listing to update ${networkOwned.length === 1 ? "it" : "them"}`, networkOwned.map((k) => ({ path: [k], message: "supplied by the network" })));
  if ("status" in input) throw new ValidationError("Change the status with a transition (submit, approve, publish, …)");
  const unknown = Object.keys(input).filter((k) => !(LISTING_EDITABLE_FIELDS as readonly string[]).includes(k));
  if (unknown.length) throw new ValidationError(`Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")} (editable: ${LISTING_EDITABLE_FIELDS.join(", ")})`);
  const parsed = EditSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid listing update", parsed.error.issues);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new ValidationError("revision is required — send the revision you loaded");
  const row = await getRow(ctx, id);
  if (!can(ctx.role, "affiliate:review") && !MACHINE_EDITABLE_STATUSES.includes(row.status)) {
    throw new ForbiddenError(`Automations can enrich listings only before review (${MACHINE_EDITABLE_STATUSES.join(" or ")}); this one is ${row.status}`);
  }
  if (expectedRevision !== row.revision) throw new ConflictError(`The listing changed since you loaded it (revision ${expectedRevision}, now ${row.revision}) — reload and try again`);
  const patch = defined(parsed.data);
  if (!Object.keys(patch).length) return view(row);
  if (patch.categoryId) {
    const [cat] = await ctx.db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, patch.categoryId), eq(categories.organizationId, ctx.orgId))).limit(1);
    if (!cat) throw new ValidationError("Unknown category");
  }
  const updated = await ctx.db.transaction(async (tx) => {
    const [u] = await tx
      .update(affiliateProducts)
      .set({ ...patch, revision: sql`${affiliateProducts.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(affiliateProducts.id, id), eq(affiliateProducts.organizationId, ctx.orgId), eq(affiliateProducts.revision, expectedRevision)))
      .returning();
    if (!u) throw new ConflictError("The listing changed while you were editing it — reload and try again");
    await syncStorefrontProduct(txContext(ctx, tx), u);
    return u;
  });
  await audit(ctx, "affiliate_product.edit", { type: "affiliate_product", id }, { fields: Object.keys(patch), revision: updated.revision });
  return view(updated);
}

export const ScoreSchema = z.object({
  score: z.number().min(0).max(100),
  // A score is a judgement, never a measurement — so never REAL.
  provenance: z.enum(["AI_INFERENCE", "ESTIMATED", "MANUAL"]),
  source: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:/-]{2,80}$/, "a short identifier, e.g. n8n:listing-score-v1"),
  reasons: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
});

/** Records a score for a listing from an automation or an operator, with its provenance, source and reasons. */
export async function scoreAffiliateProduct(ctx: ServiceContext, id: string, raw: unknown): Promise<AffiliateProductView> {
  assertCan(ctx, "affiliate:ingest");
  const parsed = ScoreSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid score", parsed.error.issues);
  await getRow(ctx, id);
  const s = parsed.data;
  const [u] = await ctx.db
    .update(affiliateProducts)
    .set({ score: Math.round(s.score * 10) / 10, scoreProvenance: s.provenance, scoreSource: s.source, scoreReasons: s.reasons, scoredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(affiliateProducts.id, id), eq(affiliateProducts.organizationId, ctx.orgId)))
    .returning();
  await audit(ctx, "affiliate_product.score", { type: "affiliate_product", id }, { score: u.score, provenance: s.provenance, source: s.source });
  return view(u);
}

export const FailureSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{2,60}$/),
  message: z.string().trim().min(1).max(500),
  /** Take a published listing off the storefront right away. */
  unpublish: z.boolean().default(false),
});

/** An automation reports a problem it observed (e.g. a failed check); optionally takes the listing off the storefront. */
export async function reportAffiliateFailure(ctx: ServiceContext, id: string, raw: unknown): Promise<AffiliateProductView> {
  assertCan(ctx, "affiliate:ingest");
  const parsed = FailureSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid failure report", parsed.error.issues);
  const f = parsed.data;
  const row = await getRow(ctx, id);
  const [u] = await ctx.db.update(affiliateProducts).set({ lastSyncError: `${f.code}: ${f.message}`.slice(0, 500), updatedAt: new Date() }).where(eq(affiliateProducts.id, row.id)).returning();
  await audit(ctx, "affiliate_product.failure", { type: "affiliate_product", id }, { code: f.code, unpublish: f.unpublish });
  if (f.unpublish && u.status === "PUBLISHED") return transitionAffiliateProduct(ctx, id, "unpublish", `Taken off the storefront after a reported failure — ${f.code}: ${f.message}`);
  return view(u);
}

function providerFor(network: string): AffiliateProvider {
  const provider = getAffiliateProvider(network);
  if (!provider) throw new ValidationError(`No provider is available for ${network} (available: ${AFFILIATE_PROVIDERS.map((p) => p.network).join(", ")})`);
  return provider;
}

/** The requested network's provider; without one, the only registered provider. */
function resolveProvider(network?: AffiliateNetworkType): AffiliateProvider {
  if (network) return providerFor(network);
  if (AFFILIATE_PROVIDERS.length === 1) return AFFILIATE_PROVIDERS[0];
  throw new ValidationError(`Choose a network: ${AFFILIATE_PROVIDERS.map((p) => p.network).join(", ")}`);
}

export const DiscoverSchema = z.object({
  network: z.enum(AFFILIATE_NETWORK_TYPES).optional(),
  marketplace: z.string().trim().toLowerCase().max(60).optional(),
  keywords: z.string().trim().min(2).max(200),
  category: z.string().trim().max(60).optional(),
  // Providers apply their own page size (Amazon returns at most 10 per page).
  limit: z.number().int().min(1).max(50).default(10),
  page: z.number().int().min(1).max(100).default(1),
});

/** Searches a network's official API and ingests the results as DISCOVERED listings. */
export async function discoverAffiliateProducts(ctx: ServiceContext, raw: unknown) {
  assertCan(ctx, "affiliate:ingest");
  const parsed = DiscoverSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid discovery request", parsed.error.issues);
  const q = parsed.data;
  const provider = resolveProvider(q.network);
  const marketplace = q.marketplace ?? provider.marketplaces()[0]?.id;
  const found = await provider.search({ marketplace, keywords: q.keywords, category: q.category, limit: q.limit, page: q.page });
  const ingested = await ingestAffiliateProducts(ctx, found.items, { source: "provider", provenance: "REAL" });
  await audit(ctx, "affiliate_products.discover", { type: "affiliate_product" }, { network: provider.network, marketplace, keywords: q.keywords, found: found.items.length });
  return { network: provider.network, marketplace, found: found.items.length, created: ingested.created, updated: ingested.updated, items: ingested.items, errors: [...found.errors, ...ingested.errors.map((e) => ({ id: e.externalId, code: "InvalidItem", message: e.message }))] };
}

export interface RefreshOptions {
  network?: AffiliateNetworkType;
  marketplace?: string;
  olderThanHours?: number;
  limit?: number;
}

async function refreshNetwork(ctx: ServiceContext, provider: AffiliateProvider, opts: RefreshOptions) {
  const cutoff = new Date(Date.now() - Math.max(0, opts.olderThanHours ?? 20) * 3_600_000);
  const rows = await ctx.db
    .select({ id: affiliateProducts.id, externalId: affiliateProducts.externalId, marketplace: affiliateProducts.marketplace })
    .from(affiliateProducts)
    .where(
      and(
        eq(affiliateProducts.organizationId, ctx.orgId),
        eq(affiliateProducts.network, provider.network),
        opts.marketplace ? eq(affiliateProducts.marketplace, opts.marketplace.toLowerCase()) : undefined,
        inArray(affiliateProducts.status, ["DISCOVERED", "REVIEW", "APPROVED", "PUBLISHED"]),
        or(isNull(affiliateProducts.dataFetchedAt), lt(affiliateProducts.dataFetchedAt, cutoff)),
      ),
    )
    // Published listings first — they are what shoppers see.
    .orderBy(sql`(${affiliateProducts.status} = 'PUBLISHED') desc`, sql`${affiliateProducts.dataFetchedAt} asc nulls first`)
    .limit(Math.min(200, Math.max(1, opts.limit ?? 50)));
  const failed: Array<{ network: AffiliateNetworkType; externalId: string; code: string; message: string }> = [];
  let refreshed = 0;
  let synced = 0;
  for (const marketplace of [...new Set(rows.map((r) => r.marketplace))]) {
    const ids = rows.filter((r) => r.marketplace === marketplace).map((r) => r.externalId);
    const result = await provider.getItems(marketplace, ids);
    const ingested = await ingestAffiliateProducts(ctx, result.items, { source: "provider", provenance: "REAL" });
    refreshed += ingested.updated;
    synced += ingested.synced;
    for (const e of result.errors) {
      if (!e.id) continue;
      failed.push({ network: provider.network, externalId: e.id, code: e.code, message: e.message });
      await ctx.db
        .update(affiliateProducts)
        .set({ lastSyncError: `${e.code}: ${e.message}`.slice(0, 500), updatedAt: new Date() })
        .where(and(eq(affiliateProducts.organizationId, ctx.orgId), eq(affiliateProducts.network, provider.network), eq(affiliateProducts.marketplace, marketplace), eq(affiliateProducts.externalId, e.id)));
    }
  }
  return { network: provider.network, checked: rows.length, refreshed, synced, failed };
}

/**
 * Re-fetches listings whose data is older than `olderThanHours` (default 20 h, inside Amazon's 24 h
 * limit) through each network's API; published listings also refresh their storefront product.
 * Listings the network no longer returns are flagged (lastSyncError), not deleted — their storefront
 * product disappears on its own when the data expires. Without `network`, every registered provider
 * that is configured is refreshed and the others are reported as skipped.
 */
export async function refreshAffiliateProducts(ctx: ServiceContext, opts: RefreshOptions = {}) {
  assertCan(ctx, "affiliate:ingest");
  const providers = opts.network ? [providerFor(opts.network)] : AFFILIATE_PROVIDERS;
  const out = {
    checked: 0,
    refreshed: 0,
    synced: 0,
    failed: [] as Array<{ network: AffiliateNetworkType; externalId: string; code: string; message: string }>,
    skipped: [] as Array<{ network: AffiliateNetworkType; reason: string }>,
    networks: [] as Array<{ network: AffiliateNetworkType; checked: number; refreshed: number; synced: number }>,
  };
  for (const provider of providers) {
    const status = provider.status();
    if (!opts.network && !status.configured) {
      out.skipped.push({ network: provider.network, reason: `not configured (${[...status.missing.map((k) => `${k} missing`), ...status.problems].join("; ") || "see provider status"})` });
      continue;
    }
    const r = await refreshNetwork(ctx, provider, opts);
    out.checked += r.checked;
    out.refreshed += r.refreshed;
    out.synced += r.synced;
    out.failed.push(...r.failed);
    out.networks.push({ network: r.network, checked: r.checked, refreshed: r.refreshed, synced: r.synced });
  }
  return out;
}

/** Provider readiness for the admin UI and n8n health checks — variable names only, never values. */
export function affiliateProviderStatus() {
  return AFFILIATE_PROVIDERS.map((p) => ({
    network: p.network,
    label: p.label,
    docsUrl: p.docsUrl,
    externalIdType: p.externalIdType,
    maxDataAgeHours: p.maxDataAgeHours,
    marketplaces: p.marketplaces().map(({ id, country, name, currency, defaultLanguage, categories }) => ({ id, country, name, currency, defaultLanguage, categories })),
    ...p.status(),
  }));
}
