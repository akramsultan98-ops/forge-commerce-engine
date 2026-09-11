import crypto from "node:crypto";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { AFFILIATE_NETWORK_TYPES } from "@/lib/constants";
import { slugify } from "@/lib/utils";
import { buildUtmUrl, isSafeRedirectUrl, type UtmParams } from "@/domain/utm";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { affiliateLinks, affiliateNetworks, products, type AffiliateLink, type AffiliateNetwork } from "../db/schema";
import { audit } from "../audit";
import { env } from "../env";
import { NotFoundError, ValidationError } from "../errors";
import { decryptSecret, encryptJson, encryptSecret, randomToken } from "../security/crypto";
import { safeFetch } from "../security/safe-fetch";

// Network-specific postback macros (what each network substitutes into the postback URL).
export const NETWORK_PRESETS: Record<string, { subIdParam: string; macros: Record<string, string>; docs: string }> = {
  IMPACT: { subIdParam: "subId1", macros: { click_id: "{SubId1}", order_id: "{OrderId}", amount: "{SaleAmount}", commission: "{Payout}", currency: "{Currency}" }, docs: "https://integrations.impact.com" },
  AWIN: { subIdParam: "clickref", macros: { click_id: "!!!clickref!!!", order_id: "!!!transactionid!!!", amount: "!!!transactionamount!!!", commission: "!!!commission!!!", currency: "!!!currency!!!" }, docs: "https://wiki.awin.com" },
  SHAREASALE: { subIdParam: "afftrack", macros: { click_id: "{afftrack}", order_id: "{ordernumber}", amount: "{amount}", commission: "{commission}", currency: "USD" }, docs: "https://www.shareasale.com" },
  PARTNERSTACK: { subIdParam: "sid", macros: { click_id: "{sid}", order_id: "{transaction_key}", amount: "{amount}", commission: "{commission}", currency: "{currency}" }, docs: "https://docs.partnerstack.com" },
  RAKUTEN: { subIdParam: "u1", macros: { click_id: "{u1}", order_id: "{order_id}", amount: "{sale_amount}", commission: "{commissions}", currency: "{currency}" }, docs: "https://developers.rakutenadvertising.com" },
  AMAZON_ASSOCIATES: { subIdParam: "ascsubtag", macros: {}, docs: "https://affiliate-program.amazon.com — Amazon has no postbacks; import earnings reports instead" },
  CJ_AFFILIATE: { subIdParam: "sid", macros: { click_id: "[sid]", order_id: "[orderId]", amount: "[saleAmount]", commission: "[commissionAmount]", currency: "[currency]" }, docs: "https://developers.cj.com" },
  CUSTOM: { subIdParam: "subid", macros: { click_id: "{click_id}", order_id: "{order_id}", amount: "{amount}", commission: "{commission}", currency: "{currency}" }, docs: "" },
};

const NetworkInput = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(AFFILIATE_NETWORK_TYPES),
  website: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^https?:\/\/\S+$/).max(300).nullable()).optional(),
  defaultCookieDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  subIdParam: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/).nullable()).optional(),
});

export async function listNetworks(ctx: Pick<ServiceContext, "db" | "orgId">) {
  const rows = await ctx.db
    .select({ network: affiliateNetworks, links: count(affiliateLinks.id) })
    .from(affiliateNetworks)
    .leftJoin(affiliateLinks, eq(affiliateLinks.networkId, affiliateNetworks.id))
    .where(eq(affiliateNetworks.organizationId, ctx.orgId))
    .groupBy(affiliateNetworks.id)
    .orderBy(asc(affiliateNetworks.name));
  return rows.map((r) => {
    const { credentialsEncrypted, postbackSecretEncrypted, ...network } = r.network;
    return { ...network, hasCredentials: !!credentialsEncrypted, hasPostbackSecret: !!postbackSecretEncrypted, links: Number(r.links) };
  });
}

export async function createNetwork(ctx: ServiceContext, raw: unknown, isDemo = false) {
  assertCan(ctx, "affiliate:write");
  const parsed = NetworkInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid network", parsed.error.issues);
  const preset = NETWORK_PRESETS[parsed.data.type];
  const [row] = await ctx.db
    .insert(affiliateNetworks)
    .values({
      organizationId: ctx.orgId,
      name: parsed.data.name,
      slug: slugify(parsed.data.name, 40),
      type: parsed.data.type,
      website: parsed.data.website ?? null,
      defaultCookieDays: parsed.data.defaultCookieDays ?? null,
      subIdParam: parsed.data.subIdParam ?? preset.subIdParam,
      status: isDemo ? "DEMO" : "NOT_CONFIGURED",
      isDemo,
    })
    .returning();
  await audit(ctx, "affiliate_network.create", { type: "affiliate_network", id: row.id });
  return row;
}

async function getNetwork(ctx: Pick<ServiceContext, "db" | "orgId">, id: string): Promise<AffiliateNetwork> {
  const [row] = await ctx.db.select().from(affiliateNetworks).where(and(eq(affiliateNetworks.id, id), eq(affiliateNetworks.organizationId, ctx.orgId))).limit(1);
  if (!row) throw new NotFoundError("Affiliate network");
  return row;
}

/** Stores API credentials encrypted (AES-256-GCM). They are never returned to the browser. */
export async function saveNetworkCredentials(ctx: ServiceContext, id: string, credentials: Record<string, string>) {
  assertCan(ctx, "integrations:manage");
  await getNetwork(ctx, id);
  const clean = Object.fromEntries(Object.entries(credentials).filter(([k, v]) => /^[a-zA-Z0-9_]{1,40}$/.test(k) && typeof v === "string" && v.trim()).map(([k, v]) => [k, v.trim()]));
  if (!Object.keys(clean).length) throw new ValidationError("Provide at least one credential");
  await ctx.db
    .update(affiliateNetworks)
    .set({ credentialsEncrypted: encryptJson(clean), status: "CONNECTED", config: { credentialsVerified: false, savedAt: new Date().toISOString() } })
    .where(eq(affiliateNetworks.id, id));
  await audit(ctx, "affiliate_network.credentials", { type: "affiliate_network", id }, { keys: Object.keys(clean) });
}

/** Rotates the postback secret and returns the full postback URL template (shown once). */
export async function rotatePostbackSecret(ctx: ServiceContext, id: string) {
  assertCan(ctx, "integrations:manage");
  const network = await getNetwork(ctx, id);
  const secret = randomToken(24);
  await ctx.db.update(affiliateNetworks).set({ postbackSecretEncrypted: encryptSecret(secret) }).where(eq(affiliateNetworks.id, id));
  await audit(ctx, "affiliate_network.postback_rotate", { type: "affiliate_network", id });
  return postbackUrl(network, secret);
}

export function postbackUrl(network: Pick<AffiliateNetwork, "slug" | "type">, secret: string): string {
  const m = NETWORK_PRESETS[network.type]?.macros ?? NETWORK_PRESETS.CUSTOM.macros;
  const u = new URL(`/api/webhooks/affiliate/${network.slug}`, env().APP_URL);
  u.searchParams.set("token", secret);
  for (const [k, v] of Object.entries(m)) u.searchParams.set(k, v);
  // Keep macro braces readable (URLSearchParams would percent-encode them).
  return decodeURIComponent(u.toString());
}

export async function verifyPostbackToken(db: Database, networkSlug: string, token: string): Promise<AffiliateNetwork | null> {
  const rows = await db.select().from(affiliateNetworks).where(eq(affiliateNetworks.slug, networkSlug));
  for (const n of rows) {
    const secret = n.postbackSecretEncrypted ? decryptSecret(n.postbackSecretEncrypted) : null;
    const fallback = env().AFFILIATE_POSTBACK_SECRET;
    for (const candidate of [secret, fallback && !fallback.startsWith("replace-with") ? fallback : null]) {
      if (candidate && token.length === candidate.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(candidate))) return n;
    }
  }
  return null;
}

// ── Links ────────────────────────────────────────────────────────────────────
const LinkInput = z.object({
  productId: z.string().uuid(),
  networkId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()).optional(),
  merchant: z.string().trim().max(120).optional(),
  url: z.string().trim().max(2048).refine(isSafeRedirectUrl, "must be an http(s) URL"),
  commissionRate: z.coerce.number().min(0).max(100).nullable().optional(),
  commissionFlat: z.coerce.number().min(0).max(100000).nullable().optional(),
  cookieDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  country: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^[A-Z]{2}$/).nullable()).optional(),
  isPrimary: z.coerce.boolean().optional(),
});

function newCode(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createLink(ctx: ServiceContext, raw: unknown, opts: { isDemo?: boolean } = {}): Promise<AffiliateLink> {
  assertCan(ctx, "affiliate:write");
  const parsed = LinkInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid affiliate link", parsed.error.issues);
  const d = parsed.data;
  const [product] = await ctx.db.select({ id: products.id }).from(products).where(and(eq(products.id, d.productId), eq(products.organizationId, ctx.orgId))).limit(1);
  if (!product) throw new NotFoundError("Product");
  const primary = d.isPrimary ?? true;
  let row: AffiliateLink | undefined;
  for (let attempt = 0; attempt < 5 && !row; attempt++) {
    [row] = await ctx.db
      .insert(affiliateLinks)
      .values({
        organizationId: ctx.orgId,
        productId: d.productId,
        networkId: d.networkId ?? null,
        merchant: d.merchant ?? null,
        url: d.url,
        code: newCode(),
        commissionRate: d.commissionRate ?? null,
        commissionFlat: d.commissionFlat ?? null,
        cookieDays: d.cookieDays ?? null,
        country: d.country ?? null,
        isPrimary: primary,
        isDemo: opts.isDemo ?? false,
      })
      .onConflictDoNothing()
      .returning();
  }
  if (!row) throw new Error("Could not allocate a unique link code");
  if (primary) {
    await ctx.db.update(affiliateLinks).set({ isPrimary: false }).where(and(eq(affiliateLinks.productId, d.productId), ne(affiliateLinks.id, row.id)));
    await ctx.db.update(products).set({ affiliateUrl: d.url }).where(eq(products.id, d.productId));
  }
  await audit(ctx, "affiliate_link.create", { type: "affiliate_link", id: row.id }, { productId: d.productId });
  return row;
}

export async function listLinks(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { productId?: string } = {}) {
  return ctx.db
    .select({ link: affiliateLinks, productTitle: products.title, productSlug: products.slug, networkName: affiliateNetworks.name })
    .from(affiliateLinks)
    .leftJoin(products, eq(products.id, affiliateLinks.productId))
    .leftJoin(affiliateNetworks, eq(affiliateNetworks.id, affiliateLinks.networkId))
    .where(and(eq(affiliateLinks.organizationId, ctx.orgId), opts.productId ? eq(affiliateLinks.productId, opts.productId) : undefined))
    .orderBy(desc(affiliateLinks.createdAt));
}

export async function primaryLinkFor(db: Database, productId: string): Promise<AffiliateLink | null> {
  const rows = await db.select().from(affiliateLinks).where(eq(affiliateLinks.productId, productId)).orderBy(desc(affiliateLinks.isPrimary), desc(affiliateLinks.createdAt)).limit(1);
  return rows[0] ?? null;
}

export function trackedUrl(code: string, utm?: Partial<UtmParams>): string {
  const base = new URL(`/r/${code}`, env().APP_URL).toString();
  if (!utm?.source || !utm.campaign) return base;
  return buildUtmUrl(base, { source: utm.source, medium: utm.medium ?? "organic", campaign: utm.campaign, content: utm.content, term: utm.term });
}

export async function setLinkStatus(ctx: ServiceContext, id: string, status: "ACTIVE" | "PAUSED" | "BROKEN" | "UNCHECKED") {
  assertCan(ctx, "affiliate:write");
  await ctx.db.update(affiliateLinks).set({ status }).where(and(eq(affiliateLinks.id, id), eq(affiliateLinks.organizationId, ctx.orgId)));
}

/** HEAD (falling back to GET) through the SSRF-safe client. 403/429 = bot protection → inconclusive. */
export async function checkLink(ctx: ServiceContext, link: AffiliateLink): Promise<{ status: AffiliateLink["status"]; code: number | null; error: string | null }> {
  if (link.isDemo) {
    await ctx.db.update(affiliateLinks).set({ lastCheckedAt: new Date(), lastError: "Demo link — not checked against the network" }).where(eq(affiliateLinks.id, link.id));
    return { status: link.status, code: null, error: "demo" };
  }
  let status: AffiliateLink["status"] = link.status;
  let code: number | null = null;
  let error: string | null = null;
  try {
    let res = await safeFetch(link.url, { method: "HEAD", timeoutMs: 8000 });
    if (res.status === 405 || res.status === 501) res = await safeFetch(link.url, { method: "GET", timeoutMs: 8000, maxBytes: 64_000 });
    code = res.status;
    if (res.status >= 200 && res.status < 300) status = "ACTIVE";
    else if (res.status === 404 || res.status === 410 || res.status >= 500) {
      status = "BROKEN";
      error = `HTTP ${res.status}`;
    } else error = `HTTP ${res.status} (inconclusive — merchant may block automated checks)`;
  } catch (err) {
    status = "BROKEN";
    error = err instanceof Error ? err.message : "request failed";
  }
  await ctx.db.update(affiliateLinks).set({ status, lastCheckedAt: new Date(), lastStatusCode: code, lastError: error }).where(eq(affiliateLinks.id, link.id));
  if (status === "BROKEN" && link.status !== "BROKEN") {
    const { notify } = await import("./notifications");
    const [p] = link.productId ? await ctx.db.select({ title: products.title }).from(products).where(eq(products.id, link.productId)).limit(1) : [];
    await notify(ctx, { type: "LINK_BROKEN", severity: "warning", title: `Affiliate link appears broken${p ? `: ${p.title}` : ""}`, body: `${link.url} returned ${error}. Traffic to this product should be paused until the link is fixed.`, entity: { type: "affiliate_link", id: link.id } });
  }
  return { status, code, error };
}

export async function checkAllLinks(ctx: ServiceContext) {
  const links = await ctx.db.select().from(affiliateLinks).where(and(eq(affiliateLinks.organizationId, ctx.orgId), inArray(affiliateLinks.status, ["ACTIVE", "UNCHECKED", "BROKEN"])));
  const summary = { checked: 0, active: 0, broken: 0, skipped: 0 };
  for (const l of links) {
    const r = await checkLink(ctx, l);
    if (r.error === "demo") summary.skipped++;
    else {
      summary.checked++;
      if (r.status === "ACTIVE") summary.active++;
      if (r.status === "BROKEN") summary.broken++;
    }
  }
  return summary;
}
