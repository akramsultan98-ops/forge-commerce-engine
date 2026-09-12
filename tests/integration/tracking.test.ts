import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { clickEvents, commissions } from "@/server/db/schema";
import { createProduct } from "@/server/services/products";
import { createLink, createNetwork, setLinkStatus } from "@/server/services/affiliate";
import { handleTrackedRedirect, isBot, recordConversion, recordEvent } from "@/server/services/tracking";
import { kpis, rangeForDays } from "@/server/services/analytics";
import { freshDb, sampleProduct } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";

describe("tracking & attribution", () => {
  it("detects bots", () => {
    expect(isBot("Googlebot/2.1")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(UA)).toBe(false);
  });

  it("redirects through /r/{code}, logs the click with UTMs and appends the network sub-id", async () => {
    const p = await createProduct(t.ctx, sampleProduct({ title: "Tracked", businessModel: "AFFILIATE", commissionPercentage: 10 }));
    const net = await createNetwork(t.ctx, { name: "Impact", type: "IMPACT" });
    const link = await createLink(t.ctx, { productId: p.id, networkId: net.id, url: "https://merchant.example/p?id=1" });
    const r = await handleTrackedRedirect(t.db, { code: link.code, utm: { utm_source: "tiktok", utm_campaign: p.slug, utm_content: "video_001" }, userAgent: UA, ip: "203.0.113.9", appUrl: "http://localhost:3000" });
    expect(r).not.toBeNull();
    const dest = new URL(r!.destination);
    expect(dest.searchParams.get("subId1")).toBe(r!.clickId);
    const [click] = await t.db.select().from(clickEvents).where(eq(clickEvents.id, r!.clickId!));
    expect(click).toMatchObject({ eventType: "AFFILIATE_CLICK", utmSource: "tiktok", utmContent: "video_001", isBot: false });
    expect(click.ipHash).not.toContain("203.0.113.9");

    // Conversion postback attributes back to the click, is idempotent and creates a commission.
    const c1 = await recordConversion(t.db, { orgId: t.orgId, source: net.slug, externalId: "order-1", clickId: r!.clickId, revenue: 20, commission: 2, currency: "USD", provenance: "REAL", networkId: net.id });
    const c2 = await recordConversion(t.db, { orgId: t.orgId, source: net.slug, externalId: "order-1", clickId: r!.clickId, revenue: 20, commission: 2, currency: "USD", provenance: "REAL" });
    expect(c1.created).toBe(true);
    expect(c2.created).toBe(false);
    expect(await t.db.select().from(commissions)).toHaveLength(1);

    await recordEvent(t.db, { orgId: t.orgId, eventType: "PAGE_VIEW", productId: p.id, userAgent: UA });
    await recordEvent(t.db, { orgId: t.orgId, eventType: "PAGE_VIEW", productId: p.id, userAgent: "curl/8.0" });
    const k = await kpis(t.ctx, rangeForDays(1));
    expect(k.affiliateClicks).toBe(1);
    expect(k.pageViews).toBe(1); // the bot view is excluded
    expect(k.commission).toBe(2);
    expect(k.conversions).toBe(1);
  });

  it("sends visitors to the product page when a link is paused, and ignores unknown codes", async () => {
    const p = await createProduct(t.ctx, sampleProduct({ title: "Paused" }));
    const link = await createLink(t.ctx, { productId: p.id, url: "https://merchant.example/x" });
    await setLinkStatus(t.ctx, link.id, "PAUSED");
    const r = await handleTrackedRedirect(t.db, { code: link.code, utm: {}, appUrl: "http://localhost:3000" });
    expect(r?.destination).toBe(`http://localhost:3000/products/${p.slug}?unavailable=1`);
    expect(await handleTrackedRedirect(t.db, { code: "nope!!", utm: {}, appUrl: "http://localhost:3000" })).toBeNull();
  });
});
