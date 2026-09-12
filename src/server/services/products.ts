import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { BUSINESS_MODELS, CURRENCIES, PRODUCT_STATUSES, type ProductStatus, type Provenance, type SourceAdapterKey } from "@/lib/constants";
import { slugify } from "@/lib/utils";
import { PROVIDER_OWNED_PRODUCT_FIELDS } from "@/domain/affiliate-products";
import { assertCan, type ServiceContext } from "../context";
import { affiliateProducts, categories, productStores, productTests, products, suppliers, type FieldProvenance, type NewProduct, type Product } from "../db/schema";
import { audit } from "../audit";
import { NotFoundError, ValidationError } from "../errors";

// ── Input validation (shared by server actions, REST API, importers) ────────
const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);
const numField = (max = 1_000_000) =>
  z.preprocess((v) => {
    const b = blankToNull(v);
    return typeof b === "string" ? Number(b.replace(/[,$€£%\s]/g, "")) : b;
  }, z.number().finite().min(0).max(max).nullable());
const intField = (max = 10_000_000) => z.preprocess((v) => { const b = blankToNull(v); return typeof b === "string" ? Math.round(Number(b)) : b; }, z.number().int().min(0).max(max).nullable());
const score = numField(100);
const httpUrl = z.preprocess(blankToNull, z.string().trim().max(2048).regex(/^https?:\/\/\S+$/i, "must be an http(s) URL").nullable());
const text = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable());
const list = (maxItems: number, maxLen = 200) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.split(/\n|\|/).map((s) => s.trim()).filter(Boolean) : v ?? []),
    z.array(z.string().max(maxLen)).max(maxItems),
  );

export const ProductInputSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: text(5000).optional(),
  categoryId: z.preprocess(blankToNull, z.string().uuid().nullable()).optional(),
  brand: text(120).optional(),
  supplierId: z.preprocess(blankToNull, z.string().uuid().nullable()).optional(),
  supplierUrl: httpUrl.optional(),
  productUrl: httpUrl.optional(),
  affiliateUrl: httpUrl.optional(),
  imageUrl: httpUrl.optional(),
  currency: z.enum(CURRENCIES).default("USD"),
  cost: numField().optional(),
  sellingPrice: numField().optional(),
  affiliateCommission: numField().optional(),
  commissionPercentage: numField(100).optional(),
  shippingCost: numField().optional(),
  shippingDaysMin: intField(365).optional(),
  shippingDaysMax: intField(365).optional(),
  countriesAvailable: list(60, 2).optional(),
  rating: numField(5).optional(),
  reviewCount: intField().optional(),
  reviewGrowth: z.preprocess((v) => { const b = blankToNull(v); return typeof b === "string" ? Number(b) : b; }, z.number().finite().min(-100).max(10000).nullable()).optional(),
  estimatedSales: intField().optional(),
  salesVelocity: numField().optional(),
  sellerCount: intField().optional(),
  adActivity: score.optional(),
  trendKeyword: text(200).optional(),
  trendScore: score.optional(),
  competitionScore: score.optional(),
  contentScore: score.optional(),
  impulseScore: score.optional(),
  problemScore: score.optional(),
  noveltyScore: score.optional(),
  saturationScore: score.optional(),
  marginScore: score.optional(),
  businessModel: z.enum(BUSINESS_MODELS).default("AFFILIATE"),
  targetAudience: text(300).optional(),
  problemSolved: text(300).optional(),
  highlights: list(10).optional(),
  tags: list(20, 60).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
});
export type ProductInput = z.input<typeof ProductInputSchema>;

/** Fields whose provenance is tracked (every important metric stores where it came from). */
export const TRACKED_FIELDS = [
  "cost",
  "sellingPrice",
  "affiliateCommission",
  "commissionPercentage",
  "shippingCost",
  "shippingDaysMin",
  "shippingDaysMax",
  "countriesAvailable",
  "rating",
  "reviewCount",
  "reviewGrowth",
  "estimatedSales",
  "salesVelocity",
  "sellerCount",
  "adActivity",
  "trendScore",
  "competitionScore",
  "contentScore",
  "impulseScore",
  "problemScore",
  "noveltyScore",
  "saturationScore",
  "marginScore",
] as const;

export function computeEstimatedMargin(p: Pick<Product, "businessModel" | "sellingPrice" | "cost" | "shippingCost" | "commissionPercentage" | "affiliateCommission">): number | null {
  if (p.businessModel === "AFFILIATE") {
    if (p.commissionPercentage !== null && p.commissionPercentage !== undefined) return p.commissionPercentage;
    if (p.affiliateCommission && p.sellingPrice) return (p.affiliateCommission / p.sellingPrice) * 100;
    return null;
  }
  if (!p.sellingPrice || p.cost === null || p.cost === undefined) return null;
  return ((p.sellingPrice - p.cost - (p.shippingCost ?? 0)) / p.sellingPrice) * 100;
}

function provenanceFor(values: Record<string, unknown>, provenance: Provenance, source: string, existing: Record<string, FieldProvenance> = {}) {
  const out = { ...existing };
  const at = new Date().toISOString();
  for (const f of TRACKED_FIELDS) {
    const v = values[f];
    if (v === undefined) continue;
    if (v === null || (Array.isArray(v) && v.length === 0)) delete out[f];
    else out[f] = { p: provenance, source, at };
  }
  return out;
}

export async function uniqueSlug(ctx: ServiceContext, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.organizationId, ctx.orgId), eq(products.slug, candidate), excludeId ? ne(products.id, excludeId) : undefined))
      .limit(1);
    if (!clash.length) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export interface CreateOptions {
  provenance?: Provenance;
  source?: SourceAdapterKey;
  sourceLabel?: string;
  sourceId?: string | null;
  sourceProductId?: string | null;
  isDemo?: boolean;
  skipAudit?: boolean;
}

export async function createProduct(ctx: ServiceContext, raw: unknown, opts: CreateOptions = {}): Promise<Product> {
  assertCan(ctx, "products:write");
  const parsed = ProductInputSchema.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid product", parsed.error.issues);
  const input = parsed.data;
  const provenance = opts.provenance ?? "MANUAL";
  const values: NewProduct = {
    ...input,
    organizationId: ctx.orgId,
    slug: await uniqueSlug(ctx, input.title),
    source: opts.source ?? "MANUAL_IMPORT",
    sourceId: opts.sourceId ?? null,
    sourceProductId: opts.sourceProductId ?? null,
    status: input.status ?? "DISCOVERED",
    businessModels: [input.businessModel],
    countriesAvailable: input.countriesAvailable ?? [],
    highlights: input.highlights ?? [],
    tags: input.tags ?? [],
    fieldProvenance: provenanceFor(input, opts.isDemo ? "DEMO" : provenance, opts.sourceLabel ?? (provenance === "MANUAL" ? "operator" : String(opts.source ?? "import"))),
    isDemo: opts.isDemo ?? false,
    statusChangedAt: new Date(),
  };
  values.estimatedMargin = computeEstimatedMargin(values as Product);
  const [row] = await ctx.db.insert(products).values(values).returning();
  if (!opts.skipAudit) await audit(ctx, "product.create", { type: "product", id: row.id }, { title: row.title, source: row.source });
  return row;
}

/** The network listing a storefront product is published from, if any (see affiliate_products.product_id). */
export async function networkListingFor(ctx: Pick<ServiceContext, "db" | "orgId">, productId: string) {
  const [row] = await ctx.db
    .select({ id: affiliateProducts.id, network: affiliateProducts.network, marketplace: affiliateProducts.marketplace, externalId: affiliateProducts.externalId, status: affiliateProducts.status })
    .from(affiliateProducts)
    .where(and(eq(affiliateProducts.productId, productId), eq(affiliateProducts.organizationId, ctx.orgId)))
    .limit(1);
  return row ?? null;
}

/** Refuses changes to fields a network listing supplies — they are rewritten from the listing on every refresh. */
async function assertNotProviderOwned(ctx: Pick<ServiceContext, "db" | "orgId">, productId: string, fields: string[]) {
  const locked = fields.filter((k) => (PROVIDER_OWNED_PRODUCT_FIELDS as readonly string[]).includes(k));
  if (!locked.length) return;
  const listing = await networkListingFor(ctx, productId);
  if (!listing) return;
  throw new ValidationError(
    `This product is published from a network listing (${listing.network}) — ${locked.join(", ")} ${locked.length === 1 ? "comes" : "come"} from the network and ${locked.length === 1 ? "updates" : "update"} on refresh. Edit the listing's FORGE fields instead.`,
    locked.map((k) => ({ path: [k], message: "supplied by the network listing" })),
  );
}

export async function updateProduct(ctx: ServiceContext, id: string, raw: unknown, provenance: Provenance = "MANUAL", sourceLabel = "operator"): Promise<Product> {
  assertCan(ctx, "products:write");
  const existing = await getProduct(ctx, id);
  const parsed = ProductInputSchema.partial().safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid product update", parsed.error.issues);
  // Only the fields the caller sent: zod fills in defaults (currency, business model) even for omitted
  // keys, and those must not overwrite the product on a partial update.
  const sent = new Set(raw && typeof raw === "object" ? Object.keys(raw) : []);
  const data = Object.fromEntries(Object.entries(parsed.data).filter(([k, v]) => v !== undefined && sent.has(k)));
  // Only fields whose value actually changed get the new provenance — re-saving a form must not
  // relabel live or demo data as operator input.
  const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify((existing as Record<string, unknown>)[k] ?? null)));
  await assertNotProviderOwned(ctx, id, Object.keys(changed));
  const patch = { ...data } as Partial<NewProduct>;
  if (patch.title && patch.title !== existing.title) patch.slug = await uniqueSlug(ctx, patch.title, id);
  if (patch.businessModel) patch.businessModels = Array.from(new Set([...(existing.businessModels ?? []), patch.businessModel]));
  patch.fieldProvenance = provenanceFor(changed, provenance, sourceLabel, existing.fieldProvenance);
  patch.estimatedMargin = computeEstimatedMargin({ ...existing, ...patch } as Product);
  const [row] = await ctx.db
    .update(products)
    .set(patch)
    .where(and(eq(products.id, id), eq(products.organizationId, ctx.orgId)))
    .returning();
  await audit(ctx, "product.update", { type: "product", id }, { fields: Object.keys(data) });
  return row;
}

/** System-level update used by agents/sources — bypasses RBAC but still tracks provenance. */
export async function applyProductFacts(ctx: ServiceContext, id: string, facts: Partial<Record<(typeof TRACKED_FIELDS)[number], number | string[] | null>>, provenance: Provenance, source: string, opts: { onlyIfWeaker?: boolean } = {}) {
  const existing = await getProduct(ctx, id);
  const rank: Record<Provenance, number> = { REAL: 5, MANUAL: 4, ESTIMATED: 3, AI_INFERENCE: 2, DEMO: 1 };
  const allowed: Record<string, unknown> = {};
  const fromListing = (await networkListingFor(ctx, id)) !== null;
  for (const [k, v] of Object.entries(facts)) {
    // A network listing owns these fields on products published from it.
    if (fromListing && (PROVIDER_OWNED_PRODUCT_FIELDS as readonly string[]).includes(k)) continue;
    const current = existing.fieldProvenance?.[k];
    const currentValue = (existing as Record<string, unknown>)[k];
    // Never let a weaker source (e.g. AI inference) overwrite stronger data (real/manual).
    if (opts.onlyIfWeaker && currentValue !== null && currentValue !== undefined && current && rank[current.p] > rank[provenance]) continue;
    allowed[k] = v;
  }
  if (!Object.keys(allowed).length) return existing;
  const fieldProvenance = provenanceFor(allowed, provenance, source, existing.fieldProvenance);
  const merged = { ...existing, ...allowed } as Product;
  const [row] = await ctx.db
    .update(products)
    .set({ ...(allowed as Partial<NewProduct>), fieldProvenance, estimatedMargin: computeEstimatedMargin(merged), lastCheckedAt: new Date() })
    .where(eq(products.id, id))
    .returning();
  return row;
}

export async function getProduct(ctx: Pick<ServiceContext, "db" | "orgId">, id: string): Promise<Product> {
  if (!z.string().uuid().safeParse(id).success) throw new NotFoundError("Product");
  const [row] = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.organizationId, ctx.orgId)))
    .limit(1);
  if (!row) throw new NotFoundError("Product");
  return row;
}

export async function getProductWithRelations(ctx: Pick<ServiceContext, "db" | "orgId">, id: string) {
  const product = await getProduct(ctx, id);
  const [category] = product.categoryId ? await ctx.db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1) : [];
  const [supplier] = product.supplierId ? await ctx.db.select().from(suppliers).where(eq(suppliers.id, product.supplierId)).limit(1) : [];
  return { product, category: category ?? null, supplier: supplier ?? null };
}

export interface ProductListQuery {
  status?: ProductStatus | ProductStatus[];
  q?: string;
  categoryId?: string;
  businessModel?: string;
  maxPrice?: number;
  minScore?: number;
  riskLevels?: string[];
  sort?: "score" | "recent" | "price" | "title";
  limit?: number;
  offset?: number;
  includeDemo?: boolean;
}

export async function listProducts(ctx: Pick<ServiceContext, "db" | "orgId">, query: ProductListQuery = {}) {
  const conds: Array<SQL | undefined> = [eq(products.organizationId, ctx.orgId)];
  if (query.status) conds.push(Array.isArray(query.status) ? inArray(products.status, query.status) : eq(products.status, query.status));
  if (query.q) {
    const term = `%${query.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    conds.push(or(ilike(products.title, term), ilike(products.description, term), ilike(products.brand, term)));
  }
  if (query.categoryId) conds.push(eq(products.categoryId, query.categoryId));
  if (query.businessModel) conds.push(eq(products.businessModel, query.businessModel as Product["businessModel"]));
  if (query.maxPrice !== undefined) conds.push(lte(products.sellingPrice, query.maxPrice));
  if (query.minScore !== undefined) conds.push(gte(products.overallScore, query.minScore));
  if (query.riskLevels?.length) conds.push(inArray(products.riskLevel, query.riskLevels as Array<"LOW" | "MEDIUM" | "HIGH">));
  if (query.includeDemo === false) conds.push(eq(products.isDemo, false));
  const where = and(...conds);
  const order =
    query.sort === "recent"
      ? [desc(products.discoveredAt)]
      : query.sort === "price"
        ? [asc(products.sellingPrice)]
        : query.sort === "title"
          ? [asc(products.title)]
          : [desc(sql`coalesce(${products.overallScore}, -1)`), desc(products.discoveredAt)];
  const [items, [{ total }]] = await Promise.all([
    ctx.db
      .select({ product: products, categoryName: categories.name, categorySlug: categories.slug })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(...order)
      .limit(Math.min(query.limit ?? 50, 200))
      .offset(query.offset ?? 0),
    ctx.db.select({ total: count() }).from(products).where(where),
  ]);
  return { items: items.map((r) => ({ ...r.product, categoryName: r.categoryName, categorySlug: r.categorySlug })), total: Number(total) };
}

export async function statusCounts(ctx: Pick<ServiceContext, "db" | "orgId">): Promise<Record<ProductStatus, number>> {
  const rows = await ctx.db.select({ status: products.status, n: count() }).from(products).where(eq(products.organizationId, ctx.orgId)).groupBy(products.status);
  const out = Object.fromEntries(PRODUCT_STATUSES.map((s) => [s, 0])) as Record<ProductStatus, number>;
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

/** Status transitions with side effects (tests, notifications, content batches). */
export async function setProductStatus(ctx: ServiceContext, id: string, status: ProductStatus, reason?: string): Promise<Product> {
  assertCan(ctx, "products:write");
  const existing = await getProduct(ctx, id);
  if (existing.status === status) return existing;
  const [row] = await ctx.db.update(products).set({ status, statusChangedAt: new Date() }).where(eq(products.id, id)).returning();
  await audit(ctx, "product.status", { type: "product", id }, { from: existing.status, to: status, reason });

  const { notify } = await import("./notifications");
  const { enqueueJob } = await import("../jobs/queue");
  if (status === "TESTING") {
    const running = await ctx.db.select({ id: productTests.id }).from(productTests).where(and(eq(productTests.productId, id), eq(productTests.status, "RUNNING"))).limit(1);
    if (!running.length) {
      const { getSetting } = await import("../settings");
      const t = await getSetting(ctx, "testing.thresholds");
      await ctx.db.insert(productTests).values({ organizationId: ctx.orgId, productId: id, plannedDays: t.maxDays, thresholds: t });
    }
  }
  if (status === "WINNER") {
    await notify(ctx, { type: "PRODUCT_WINNER", severity: "success", title: `${row.title} became a winner`, body: reason ?? "It met the winner thresholds. A new content batch is being generated.", entity: { type: "product", id } });
    await enqueueJob(ctx.db, { type: "content_generation", orgId: ctx.orgId, payload: { productId: id, reason: "winner", batch: "scale" }, trigger: "EVENT", dedupeKey: `winner-content:${id}` });
  }
  if (status === "KILLED" || status === "ARCHIVED" || status === "PAUSED") {
    await ctx.db.update(productTests).set({ status: "COMPLETED", endedAt: new Date() }).where(and(eq(productTests.productId, id), eq(productTests.status, "RUNNING")));
  }
  return row;
}

/** Automation: the product can no longer be bought (out of stock, delisted, dead merchant page) → pause + alert. */
export async function markProductUnavailable(ctx: ServiceContext, productId: string, reason: string) {
  const [p] = await ctx.db.update(products).set({ available: false, lastCheckedAt: new Date() }).where(and(eq(products.id, productId), eq(products.organizationId, ctx.orgId))).returning();
  if (!p) return null;
  if (["TESTING", "WINNER", "SCALING", "APPROVED"].includes(p.status)) await setProductStatus({ ...ctx, role: "admin" }, productId, "PAUSED", reason);
  const { notify } = await import("./notifications");
  await notify(ctx, { type: "INVENTORY_UNAVAILABLE", severity: "warning", title: `${p.title} is unavailable`, body: `${reason}. The product was paused so no more traffic is sent to it.`, entity: { type: "product", id: productId } });
  return p;
}

export async function deleteProduct(ctx: ServiceContext, id: string) {
  assertCan(ctx, "products:delete");
  await getProduct(ctx, id);
  await ctx.db.delete(products).where(eq(products.id, id));
  await audit(ctx, "product.delete", { type: "product", id });
}

export async function assignToStore(ctx: ServiceContext, productId: string, storeId: string, published = true) {
  assertCan(ctx, "products:write");
  await ctx.db.insert(productStores).values({ productId, storeId, published }).onConflictDoUpdate({ target: [productStores.productId, productStores.storeId], set: { published } });
}

export async function findProductByQuery(ctx: Pick<ServiceContext, "db" | "orgId">, q: string): Promise<Product | null> {
  const cleaned = q.replace(/["'“”]/g, "").trim();
  if (!cleaned) return null;
  const bySlug = await ctx.db.select().from(products).where(and(eq(products.organizationId, ctx.orgId), eq(products.slug, slugify(cleaned)))).limit(1);
  if (bySlug[0]) return bySlug[0];
  const words = cleaned.split(/\s+/).filter((w) => w.length > 2).slice(0, 5);
  if (!words.length) return null;
  const rows = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.organizationId, ctx.orgId), or(...words.map((w) => ilike(products.title, `%${w.replace(/[%_\\]/g, "")}%`)))))
    .limit(20);
  const scored = rows
    .map((p) => ({ p, hits: words.filter((w) => p.title.toLowerCase().includes(w.toLowerCase())).length }))
    .sort((a, b) => b.hits - a.hits || (b.p.overallScore ?? 0) - (a.p.overallScore ?? 0));
  return scored[0]?.p ?? null;
}
