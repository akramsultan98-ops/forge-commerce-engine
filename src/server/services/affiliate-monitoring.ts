// Measurement and failure reporting for network listings: product views, outbound clicks, redirect
// fallbacks and traffic sources come from first-party tracking; conversions and commission are kept
// separate and only recorded from what a network reports (never estimated). Also the failure feed
// automations poll.

import { and, count, desc, eq, gte, inArray, isNotNull, lte, sum } from "drizzle-orm";
import { z } from "zod";
import { AFFILIATE_NETWORK_TYPES, type AffiliateNetworkType } from "@/lib/constants";
import { assertCan, type ServiceContext } from "../context";
import { affiliateLinks, affiliateProducts, clickEvents, conversionEvents, products } from "../db/schema";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import { affiliateProviderStatus } from "./affiliate-products";
import { recordConversion } from "./tracking";

export interface ListingTracking {
  affiliateProductId: string;
  externalId: string;
  network: AffiliateNetworkType;
  marketplace: string;
  title: string;
  status: string;
  productId: string | null;
  /** Storefront product page views (bots excluded). */
  views: number;
  /** Tracked-link clicks that were redirected to the merchant. */
  outboundClicks: number;
  /** Tracked-link clicks that could not go to the merchant (link paused/broken, listing unpublished). */
  redirectFallbacks: number;
  clickThroughRate: number | null;
  /** Reported by the network (postback or imported report) — per currency, never mixed or converted. */
  conversions: number;
  revenue: Record<string, number>;
  commission: Record<string, number>;
}

const clampDays = (d: number | undefined) => Math.min(365, Math.max(1, Math.trunc(d ?? 30)));
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const add = (m: Record<string, number>, k: string, v: number) => {
  if (v) m[k] = Math.round(((m[k] ?? 0) + v) * 100) / 100;
};

/** Per-listing funnel over the last `days` days: every listing ever published, or one listing. */
export async function affiliateTracking(ctx: ServiceContext, opts: { days?: number; network?: AffiliateNetworkType; affiliateProductId?: string; limit?: number } = {}) {
  assertCan(ctx, "affiliate:read");
  const days = clampDays(opts.days);
  const since = new Date(Date.now() - days * 86_400_000);
  const listings = await ctx.db
    .select({ id: affiliateProducts.id, externalId: affiliateProducts.externalId, network: affiliateProducts.network, marketplace: affiliateProducts.marketplace, title: affiliateProducts.title, status: affiliateProducts.status, productId: affiliateProducts.productId })
    .from(affiliateProducts)
    .where(
      and(
        eq(affiliateProducts.organizationId, ctx.orgId),
        opts.network ? eq(affiliateProducts.network, opts.network) : undefined,
        opts.affiliateProductId ? eq(affiliateProducts.id, opts.affiliateProductId) : isNotNull(affiliateProducts.publishedAt),
      ),
    )
    .orderBy(desc(affiliateProducts.publishedAt))
    .limit(Math.min(500, Math.max(1, opts.limit ?? 100)));
  if (!listings.length) return { days, since, items: [] as ListingTracking[] };
  const ids = listings.map((l) => l.id);
  const productIds = listings.flatMap((l) => (l.productId ? [l.productId] : []));
  const clicks = await ctx.db
    .select({ id: clickEvents.affiliateProductId, type: clickEvents.eventType, n: count() })
    .from(clickEvents)
    .where(and(eq(clickEvents.organizationId, ctx.orgId), inArray(clickEvents.affiliateProductId, ids), inArray(clickEvents.eventType, ["AFFILIATE_CLICK", "REDIRECT_FALLBACK"]), gte(clickEvents.createdAt, since), eq(clickEvents.isBot, false)))
    .groupBy(clickEvents.affiliateProductId, clickEvents.eventType);
  const views = productIds.length
    ? await ctx.db
        .select({ productId: clickEvents.productId, n: count() })
        .from(clickEvents)
        .where(and(eq(clickEvents.organizationId, ctx.orgId), inArray(clickEvents.productId, productIds), eq(clickEvents.eventType, "PAGE_VIEW"), gte(clickEvents.createdAt, since), eq(clickEvents.isBot, false)))
        .groupBy(clickEvents.productId)
    : [];
  const conversions = productIds.length
    ? await ctx.db
        .select({ productId: conversionEvents.productId, currency: conversionEvents.currency, n: count(), revenue: sum(conversionEvents.revenue), commission: sum(conversionEvents.commission) })
        .from(conversionEvents)
        .where(and(eq(conversionEvents.organizationId, ctx.orgId), inArray(conversionEvents.productId, productIds), gte(conversionEvents.occurredAt, since)))
        .groupBy(conversionEvents.productId, conversionEvents.currency)
    : [];
  const items = listings.map((l): ListingTracking => {
    const outboundClicks = num(clicks.find((c) => c.id === l.id && c.type === "AFFILIATE_CLICK")?.n);
    const v = l.productId ? num(views.find((x) => x.productId === l.productId)?.n) : 0;
    const revenue: Record<string, number> = {};
    const commission: Record<string, number> = {};
    let n = 0;
    for (const c of conversions.filter((x) => x.productId && x.productId === l.productId)) {
      n += num(c.n);
      add(revenue, c.currency, num(c.revenue));
      add(commission, c.currency, num(c.commission));
    }
    return {
      affiliateProductId: l.id,
      externalId: l.externalId,
      network: l.network,
      marketplace: l.marketplace,
      title: l.title,
      status: l.status,
      productId: l.productId,
      views: v,
      outboundClicks,
      redirectFallbacks: num(clicks.find((c) => c.id === l.id && c.type === "REDIRECT_FALLBACK")?.n),
      clickThroughRate: v ? Math.round((outboundClicks / v) * 10_000) / 10_000 : null,
      conversions: n,
      revenue,
      commission,
    };
  });
  return { days, since, items };
}

/** Where a listing's outbound clicks came from (UTM source / campaign), for the admin and reports. */
export async function listingClickSources(ctx: ServiceContext, affiliateProductId: string, days = 30) {
  assertCan(ctx, "affiliate:read");
  const since = new Date(Date.now() - clampDays(days) * 86_400_000);
  const rows = await ctx.db
    .select({ source: clickEvents.utmSource, campaign: clickEvents.utmCampaign, n: count() })
    .from(clickEvents)
    .where(and(eq(clickEvents.organizationId, ctx.orgId), eq(clickEvents.affiliateProductId, affiliateProductId), eq(clickEvents.eventType, "AFFILIATE_CLICK"), gte(clickEvents.createdAt, since), eq(clickEvents.isBot, false)))
    .groupBy(clickEvents.utmSource, clickEvents.utmCampaign)
    .orderBy(desc(count()))
    .limit(10);
  return rows.map((r) => ({ source: r.source ?? "(direct)", campaign: r.campaign, clicks: num(r.n) }));
}

/**
 * What needs attention — the feed an automation polls: refresh/check errors, published listings whose
 * storefront data has expired or expires soon, broken listing links, redirect fallbacks in the last
 * 24 h, and providers that are not configured.
 */
export async function affiliateFailures(ctx: ServiceContext, opts: { expiringWithinHours?: number } = {}) {
  assertCan(ctx, "affiliate:read");
  const now = new Date();
  const window = new Date(now.getTime() + Math.min(24, Math.max(0, opts.expiringWithinHours ?? 4)) * 3_600_000);
  const listingCols = { id: affiliateProducts.id, network: affiliateProducts.network, marketplace: affiliateProducts.marketplace, externalId: affiliateProducts.externalId, title: affiliateProducts.title, status: affiliateProducts.status };
  const syncErrors = await ctx.db
    .select({ ...listingCols, error: affiliateProducts.lastSyncError, dataFetchedAt: affiliateProducts.dataFetchedAt })
    .from(affiliateProducts)
    .where(and(eq(affiliateProducts.organizationId, ctx.orgId), isNotNull(affiliateProducts.lastSyncError), inArray(affiliateProducts.status, ["DISCOVERED", "REVIEW", "APPROVED", "PUBLISHED"])))
    .orderBy(desc(affiliateProducts.updatedAt))
    .limit(200);
  const expiring = await ctx.db
    .select({ ...listingCols, productId: products.id, expiresAt: products.externalDataExpiresAt })
    .from(affiliateProducts)
    .innerJoin(products, eq(products.id, affiliateProducts.productId))
    .where(and(eq(affiliateProducts.organizationId, ctx.orgId), eq(affiliateProducts.status, "PUBLISHED"), isNotNull(products.externalDataExpiresAt), lte(products.externalDataExpiresAt, window)))
    .orderBy(products.externalDataExpiresAt)
    .limit(200);
  const brokenLinks = await ctx.db
    .select({ id: affiliateLinks.id, code: affiliateLinks.code, affiliateProductId: affiliateLinks.affiliateProductId, lastError: affiliateLinks.lastError })
    .from(affiliateLinks)
    .where(and(eq(affiliateLinks.organizationId, ctx.orgId), isNotNull(affiliateLinks.affiliateProductId), eq(affiliateLinks.status, "BROKEN")))
    .limit(200);
  const fallbacks = await ctx.db
    .select({ affiliateProductId: clickEvents.affiliateProductId, n: count() })
    .from(clickEvents)
    .where(and(eq(clickEvents.organizationId, ctx.orgId), eq(clickEvents.eventType, "REDIRECT_FALLBACK"), isNotNull(clickEvents.affiliateProductId), gte(clickEvents.createdAt, new Date(now.getTime() - 86_400_000)), eq(clickEvents.isBot, false)))
    .groupBy(clickEvents.affiliateProductId)
    .orderBy(desc(count()))
    .limit(100);
  const isExpired = (e: { expiresAt: Date | null }) => !!e.expiresAt && e.expiresAt <= now;
  return {
    checkedAt: now,
    syncErrors,
    expired: expiring.filter(isExpired),
    expiringSoon: expiring.filter((e) => !isExpired(e)),
    brokenLinks,
    redirectFallbacks: fallbacks.map((f) => ({ affiliateProductId: f.affiliateProductId, last24h: num(f.n) })),
    providers: affiliateProviderStatus()
      .filter((p) => !p.configured)
      .map((p) => ({ network: p.network, missing: p.missing, problems: p.problems })),
  };
}

export const ListingConversionSchema = z.object({
  network: z.enum(AFFILIATE_NETWORK_TYPES),
  marketplace: z.string().trim().toLowerCase().max(60),
  externalId: z.string().trim().min(1).max(64),
  /** The network's order / report-row id — the idempotency key. */
  orderId: z.string().trim().min(1).max(200),
  occurredAt: z.coerce.date(),
  revenue: z.number().min(0).max(10_000_000),
  commission: z.number().min(0).max(10_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  clickId: z.string().uuid().optional(),
});

/**
 * Imports conversions a network reported (e.g. rows of an Amazon Associates earnings report — Amazon
 * sends no postbacks) against their listings. Commission is stored exactly as reported, with MANUAL
 * provenance (FORGE cannot verify an uploaded report), idempotent on source + orderId.
 */
export async function importListingConversions(ctx: ServiceContext, input: { source?: string; items: unknown[] }) {
  assertCan(ctx, "affiliate:ingest");
  const source = input.source ?? "network_report";
  if (!/^[a-z0-9_-]{2,40}$/.test(source)) throw new ValidationError("source must be 2–40 lowercase letters, digits, - or _ (e.g. amazon_eg_report)");
  const result = { created: 0, duplicates: 0, errors: [] as Array<{ index: number; message: string }> };
  for (const [index, raw] of input.items.entries()) {
    const parsed = ListingConversionSchema.safeParse(raw);
    if (!parsed.success) {
      result.errors.push({ index, message: parsed.error.issues.map((i) => `${i.path.join(".") || "item"}: ${i.message}`).join("; ") });
      continue;
    }
    const d = parsed.data;
    const [listing] = await ctx.db
      .select({ id: affiliateProducts.id, productId: affiliateProducts.productId, networkId: affiliateProducts.networkId, isDemo: affiliateProducts.isDemo })
      .from(affiliateProducts)
      .where(and(eq(affiliateProducts.organizationId, ctx.orgId), eq(affiliateProducts.network, d.network), eq(affiliateProducts.marketplace, d.marketplace), eq(affiliateProducts.externalId, d.externalId)))
      .limit(1);
    if (!listing) {
      result.errors.push({ index, message: `No ${d.network} listing ${d.externalId} on ${d.marketplace}` });
      continue;
    }
    const r = await recordConversion(ctx.db, {
      orgId: ctx.orgId,
      source,
      externalId: d.orderId,
      clickId: d.clickId ?? null,
      productId: listing.productId,
      networkId: listing.networkId,
      revenue: d.revenue,
      commission: d.commission,
      currency: d.currency,
      occurredAt: d.occurredAt,
      provenance: "MANUAL",
      isDemo: listing.isDemo,
    });
    if (r.created) result.created++;
    else result.duplicates++;
  }
  if (result.created) await audit(ctx, "affiliate_conversions.import", { type: "conversion" }, { source, created: result.created, duplicates: result.duplicates, errors: result.errors.length });
  return result;
}
