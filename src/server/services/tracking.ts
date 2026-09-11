// First-party tracking: page views, product/affiliate clicks, tracked redirects and conversions.
// No third-party trackers. IPs are stored only as keyed hashes; visitor ids are random and
// only persisted when the visitor accepted analytics cookies.

import { and, eq } from "drizzle-orm";
import type { EventType, Provenance } from "@/lib/constants";
import { appendSubId, buildUtmUrl, isSafeRedirectUrl } from "@/domain/utm";
import type { Database } from "../db/client";
import { affiliateLinks, affiliateNetworks, campaigns, clickEvents, commissions, content, conversionEvents, products } from "../db/schema";
import { hashIp } from "../security/crypto";

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|python-requests|curl\/|wget|httpclient|go-http|axios|node-fetch|pingdom|uptime/i;

export function isBot(ua: string | null | undefined): boolean {
  return !ua || BOT_RE.test(ua);
}

export function deviceOf(ua: string | null | undefined): "mobile" | "tablet" | "desktop" {
  if (!ua) return "desktop";
  if (/ipad|tablet/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

export interface Utm {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

export interface TrackInput {
  orgId: string;
  eventType: EventType;
  productId?: string | null;
  landingPageId?: string | null;
  affiliateLinkId?: string | null;
  experimentId?: string | null;
  variant?: string | null;
  visitorId?: string | null;
  utm?: Utm;
  referrer?: string | null;
  path?: string | null;
  country?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  isDemo?: boolean;
}

async function resolveAttribution(db: Database, orgId: string, productId: string | null | undefined, utm: Utm) {
  let campaignId: string | null = null;
  let contentId: string | null = null;
  if (utm.utm_campaign) {
    const [c] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.organizationId, orgId), eq(campaigns.utmCampaign, utm.utm_campaign), utm.utm_source ? eq(campaigns.utmSource, utm.utm_source) : undefined))
      .limit(1);
    campaignId = c?.id ?? null;
  }
  if (productId && utm.utm_content) {
    const [c] = await db.select({ id: content.id }).from(content).where(and(eq(content.productId, productId), eq(content.utmContent, utm.utm_content))).limit(1);
    contentId = c?.id ?? null;
  }
  return { campaignId, contentId };
}

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

export async function recordEvent(db: Database, input: TrackInput): Promise<string> {
  const utm = input.utm ?? {};
  const { campaignId, contentId } = await resolveAttribution(db, input.orgId, input.productId, utm);
  const [row] = await db
    .insert(clickEvents)
    .values({
      organizationId: input.orgId,
      eventType: input.eventType,
      productId: input.productId ?? null,
      landingPageId: input.landingPageId ?? null,
      affiliateLinkId: input.affiliateLinkId ?? null,
      campaignId,
      contentId,
      experimentId: input.experimentId ?? null,
      variant: clip(input.variant, 40),
      visitorId: clip(input.visitorId, 64),
      utmSource: clip(utm.utm_source, 100),
      utmMedium: clip(utm.utm_medium, 100),
      utmCampaign: clip(utm.utm_campaign, 100),
      utmContent: clip(utm.utm_content, 100),
      utmTerm: clip(utm.utm_term, 100),
      referrer: clip(input.referrer, 500),
      path: clip(input.path, 500),
      country: clip(input.country?.toUpperCase() ?? null, 2),
      device: deviceOf(input.userAgent),
      ipHash: hashIp(input.ip),
      userAgent: clip(input.userAgent, 300),
      isBot: isBot(input.userAgent),
      isDemo: input.isDemo ?? false,
    })
    .returning({ id: clickEvents.id });
  return row.id;
}

/**
 * Resolves /r/{code}: logs an AFFILIATE_CLICK (with attribution) and returns the destination.
 * Paused/broken links fall back to the product page so visitors never hit a dead end.
 */
export async function handleTrackedRedirect(
  db: Database,
  input: { code: string; utm: Utm; visitorId?: string | null; ip?: string | null; userAgent?: string | null; referrer?: string | null; country?: string | null; appUrl: string },
): Promise<{ destination: string; clickId: string | null } | null> {
  if (!/^[A-Za-z0-9]{6,16}$/.test(input.code)) return null;
  const [row] = await db
    .select({ link: affiliateLinks, network: affiliateNetworks, productSlug: products.slug, businessModel: products.businessModel })
    .from(affiliateLinks)
    .leftJoin(affiliateNetworks, eq(affiliateNetworks.id, affiliateLinks.networkId))
    .leftJoin(products, eq(products.id, affiliateLinks.productId))
    .where(eq(affiliateLinks.code, input.code))
    .limit(1);
  if (!row) return null;
  const { link, network } = row;
  if ((link.status === "PAUSED" || link.status === "BROKEN") && row.productSlug) {
    return { destination: new URL(`/products/${row.productSlug}?unavailable=1`, input.appUrl).toString(), clickId: null };
  }
  if (!isSafeRedirectUrl(link.url)) return null;
  // Affiliate destinations are AFFILIATE_CLICKs; owned-store destinations (Shopify/dropshipping checkout) are PRODUCT_CLICKs.
  const eventType = network || row.businessModel === "AFFILIATE" ? "AFFILIATE_CLICK" : "PRODUCT_CLICK";
  const clickId = await recordEvent(db, {
    orgId: link.organizationId,
    eventType,
    productId: link.productId,
    affiliateLinkId: link.id,
    visitorId: input.visitorId,
    utm: input.utm,
    referrer: input.referrer,
    path: `/r/${input.code}`,
    country: input.country,
    ip: input.ip,
    userAgent: input.userAgent,
    isDemo: link.isDemo,
  });
  let destination = appendSubId(link.url, network?.subIdParam, clickId);
  if (network?.config && (network.config as { passUtm?: boolean }).passUtm && input.utm.utm_source && input.utm.utm_campaign) {
    destination = buildUtmUrl(destination, { source: input.utm.utm_source, medium: input.utm.utm_medium ?? "organic", campaign: input.utm.utm_campaign, content: input.utm.utm_content });
  }
  return { destination, clickId };
}

export interface ConversionInput {
  orgId: string;
  source: string;
  externalId: string | null;
  clickId?: string | null;
  productId?: string | null;
  networkId?: string | null;
  revenue: number;
  commission: number;
  currency: string;
  occurredAt?: Date;
  provenance: Provenance;
  isDemo?: boolean;
}

/** Idempotent (per source + external id). Links the conversion back to its click for attribution. */
export async function recordConversion(db: Database, input: ConversionInput): Promise<{ id: string; created: boolean }> {
  let click: typeof clickEvents.$inferSelect | undefined;
  if (input.clickId && /^[0-9a-f-]{36}$/i.test(input.clickId)) {
    [click] = await db.select().from(clickEvents).where(and(eq(clickEvents.id, input.clickId), eq(clickEvents.organizationId, input.orgId))).limit(1);
  }
  const inserted = await db
    .insert(conversionEvents)
    .values({
      organizationId: input.orgId,
      type: "PURCHASE",
      productId: click?.productId ?? input.productId ?? null,
      affiliateLinkId: click?.affiliateLinkId ?? null,
      clickEventId: click?.id ?? null,
      campaignId: click?.campaignId ?? null,
      contentId: click?.contentId ?? null,
      source: input.source.slice(0, 60),
      externalId: input.externalId?.slice(0, 200) ?? null,
      revenue: Math.max(0, input.revenue),
      commission: Math.max(0, input.commission),
      currency: input.currency.slice(0, 3).toUpperCase(),
      utmSource: click?.utmSource ?? null,
      utmCampaign: click?.utmCampaign ?? null,
      utmContent: click?.utmContent ?? null,
      country: click?.country ?? null,
      provenance: input.provenance,
      isDemo: input.isDemo ?? false,
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: conversionEvents.id });
  if (!inserted[0]) {
    const [existing] = await db
      .select({ id: conversionEvents.id })
      .from(conversionEvents)
      .where(and(eq(conversionEvents.organizationId, input.orgId), eq(conversionEvents.source, input.source), eq(conversionEvents.externalId, input.externalId ?? "")))
      .limit(1);
    return { id: existing?.id ?? "", created: false };
  }
  if (input.commission > 0) {
    await db.insert(commissions).values({
      organizationId: input.orgId,
      networkId: input.networkId ?? null,
      affiliateLinkId: click?.affiliateLinkId ?? null,
      productId: click?.productId ?? input.productId ?? null,
      conversionEventId: inserted[0].id,
      externalId: input.externalId,
      amount: input.commission,
      currency: input.currency.slice(0, 3).toUpperCase(),
      status: "PENDING",
      isDemo: input.isDemo ?? false,
      occurredAt: input.occurredAt ?? new Date(),
    });
  }
  return { id: inserted[0].id, created: true };
}
