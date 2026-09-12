import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { affiliateLinks, affiliateProducts, categories, clickEvents, products } from "@/server/db/schema";
import { userContext, type ServiceContext } from "@/server/context";
import { createUser } from "@/server/auth/core";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { getAffiliateProduct, ingestAffiliateProducts, listAffiliateProducts, reportAffiliateFailure, scoreAffiliateProduct, transitionAffiliateProduct, updateAffiliateProduct } from "@/server/services/affiliate-products";
import { visibleOnStorefront } from "@/server/services/affiliate-publishing";
import { affiliateFailures, affiliateTracking, importListingConversions } from "@/server/services/affiliate-monitoring";
import { checkLink, createLink } from "@/server/services/affiliate";
import { updateProduct } from "@/server/services/products";
import { handleTrackedRedirect, recordEvent } from "@/server/services/tracking";
import { asRole, freshDb } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
let reviewerId = "";
let foodStorageId = "";

beforeAll(async () => {
  t = await freshDb();
  reviewerId = (await createUser(t.db, { organizationId: t.orgId, email: "reviewer@example.test", name: "Reviewer", password: "a-long-test-password-1", role: "operator" })).id;
  [{ id: foodStorageId }] = await t.db.insert(categories).values({ organizationId: t.orgId, name: "Food Storage", slug: "food-storage" }).returning();
});
afterAll(async () => t.close());

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const IMAGES = ["https://m.media-amazon.com/images/I/lunch-1.jpg", "https://m.media-amazon.com/images/I/lunch-2.jpg"];
const tagged = (asin: string) => `https://www.amazon.eg/dp/${asin}?tag=forgetest-21`;

const listing = (externalId: string, over: Record<string, unknown> = {}) => ({
  network: "AMAZON_ASSOCIATES",
  marketplace: "www.amazon.eg",
  country: "EG",
  externalId,
  title: `Lunch box ${externalId}`,
  description: "A two-compartment lunch box.",
  features: ["Leak-proof lid", "BPA-free"],
  category: "Food Storage",
  categoryPath: ["Kitchen & Dining", "Food Storage"],
  brand: "Acme",
  productUrl: `https://www.amazon.eg/dp/${externalId}`,
  affiliateUrl: tagged(externalId),
  imageUrls: IMAGES,
  price: 349,
  currency: "EGP",
  availability: "IN_STOCK",
  ...over,
});

/** A signed-in person (session actor). */
const person = (): ServiceContext => userContext({ orgId: t.orgId, userId: reviewerId, role: "operator", db: t.db });
/** An API key (as apiRoute builds it) with the given role. */
const apiKey = (role: "automation" | "operator"): ServiceContext => ({ ...userContext({ orgId: t.orgId, userId: "00000000-0000-0000-0000-000000000000", role, actor: "api_key", db: t.db }), userId: null });

async function ingest(externalId: string, over: Record<string, unknown> = {}) {
  const r = await ingestAffiliateProducts(t.ctx, [listing(externalId, over)], { source: "provider", provenance: "REAL" });
  expect(r.errors).toEqual([]);
  return r;
}
async function approved(externalId: string, over: Record<string, unknown> = {}) {
  const id = (await ingest(externalId, over)).items[0].id;
  await transitionAffiliateProduct(t.ctx, id, "submit");
  await transitionAffiliateProduct(t.ctx, id, "approve");
  return id;
}
const productRow = async (id: string) => (await t.db.select().from(products).where(eq(products.id, id)))[0];
const linkFor = async (listingId: string) => (await t.db.select().from(affiliateLinks).where(eq(affiliateLinks.affiliateProductId, listingId)))[0];

describe("publishing a listing to the storefront", () => {
  it("creates the storefront product from the listing, with its tracked link, freshness and provenance", async () => {
    const id = await approved("B0PUBLISH1");
    const published = await transitionAffiliateProduct(person(), id, "publish", "Great fit for the kitchen range");
    expect(published).toMatchObject({ status: "PUBLISHED", productId: expect.any(String) });
    expect(published.publishedAt).toBeInstanceOf(Date);

    const p = await productRow(published.productId!);
    expect(p).toMatchObject({
      title: "Lunch box B0PUBLISH1",
      description: "A two-compartment lunch box.",
      brand: "Acme",
      productUrl: "https://www.amazon.eg/dp/B0PUBLISH1",
      affiliateUrl: tagged("B0PUBLISH1"),
      imageUrl: IMAGES[0],
      gallery: [IMAGES[1]],
      sellingPrice: 349,
      currency: "EGP",
      available: true,
      status: "APPROVED",
      businessModel: "AFFILIATE",
      source: "AFFILIATE_NETWORK",
      sourceProductId: "AMAZON_ASSOCIATES:www.amazon.eg:B0PUBLISH1",
      categoryId: foodStorageId, // matched from the network category — FORGE never creates categories on its own
      countriesAvailable: ["EG"],
      highlights: ["Leak-proof lid", "BPA-free"],
    });
    // Amazon: the price carries its observation time and the product disappears 24 h after fetching.
    expect(p.priceAsOf?.getTime()).toBe(published.dataFetchedAt!.getTime());
    expect(p.externalDataExpiresAt!.getTime() - published.dataFetchedAt!.getTime()).toBe(24 * 3_600_000);
    expect(p.fieldProvenance.sellingPrice).toMatchObject({ p: "REAL", source: "amazon_associates:www.amazon.eg" });

    const link = await linkFor(id);
    expect(link).toMatchObject({ productId: p.id, url: tagged("B0PUBLISH1"), isPrimary: true, status: "UNCHECKED", merchant: "Amazon.eg" });
    const detail = await getAffiliateProduct(t.ctx, id);
    expect(detail.storefront).toMatchObject({ productId: p.id, visible: true, path: `/products/${p.slug}` });
    expect(detail.storefront?.link?.trackedUrl).toContain(`/r/${link.code}`);
  });

  it("unpublishes to a paused product and link, and republishes the same product and link", async () => {
    const id = await approved("B0REPUB001");
    const { productId } = await transitionAffiliateProduct(person(), id, "publish");
    const { code } = await linkFor(id);

    const down = await transitionAffiliateProduct(apiKey("automation"), id, "unpublish", "Merchant changed the listing");
    expect(down.status).toBe("APPROVED");
    expect((await productRow(productId!)).status).toBe("PAUSED");
    expect((await linkFor(id)).status).toBe("PAUSED");

    // A click on the paused link falls back to the product page and is recorded as a fallback.
    const r = await handleTrackedRedirect(t.db, { code, utm: { utm_source: "tiktok", utm_campaign: "launch" }, userAgent: UA, appUrl: "http://localhost:3000" });
    expect(r?.clickId).toBeNull();
    const [fallback] = await t.db.select().from(clickEvents).where(and(eq(clickEvents.affiliateProductId, id), eq(clickEvents.eventType, "REDIRECT_FALLBACK")));
    expect(fallback).toMatchObject({ utmSource: "tiktok", productId: productId });

    const again = await transitionAffiliateProduct(person(), id, "publish");
    expect(again.productId).toBe(productId);
    expect((await productRow(productId!)).status).toBe("APPROVED");
    expect(await linkFor(id)).toMatchObject({ code, status: "UNCHECKED" });
    expect(await t.db.select().from(products).where(eq(products.sourceProductId, "AMAZON_ASSOCIATES:www.amazon.eg:B0REPUB001"))).toHaveLength(1);

    await transitionAffiliateProduct(t.ctx, id, "archive");
    expect((await productRow(productId!)).status).toBe("ARCHIVED");
  });

  it("keeps the published product current on refresh and hides it once the data is too old", async () => {
    const id = await approved("B0REFRESH1");
    const { productId } = await transitionAffiliateProduct(person(), id, "publish");
    const visible = async () => (await t.db.select({ id: products.id }).from(products).where(and(eq(products.id, productId!), visibleOnStorefront()))).length === 1;
    expect(await visible()).toBe(true);

    const r = await ingest("B0REFRESH1", { price: 299, availability: "OUT_OF_STOCK" });
    expect(r.synced).toBe(1);
    expect(await productRow(productId!)).toMatchObject({ sellingPrice: 299, available: false });

    await ingest("B0REFRESH1", { fetchedAt: new Date(Date.now() - 30 * 3_600_000) });
    expect(await visible()).toBe(false);
    expect((await affiliateFailures(t.ctx)).expired.map((e) => e.id)).toContain(id);

    await ingest("B0REFRESH1");
    expect(await visible()).toBe(true);
    expect((await productRow(productId!)).available).toBe(true);
  });

  it("refuses to publish a listing that is missing what the storefront needs", async () => {
    const id = await approved("B0NOTREADY", { description: null, category: null, categoryPath: [], imageUrls: [] });
    await expect(transitionAffiliateProduct(person(), id, "publish")).rejects.toThrow(/no image.*no description.*no category/);
  });
});

describe("machines prepare, people decide", () => {
  it("lets automation keys ingest, submit and take listings down — never approve or publish", async () => {
    const automation = apiKey("automation");
    const { items } = await ingestAffiliateProducts(automation, [listing("B0MACHINE1")], { source: "n8n", provenance: "MANUAL" });
    const id = items[0].id;
    await transitionAffiliateProduct(automation, id, "submit");
    await expect(transitionAffiliateProduct(automation, id, "approve")).rejects.toThrow(ForbiddenError);
    await expect(transitionAffiliateProduct(automation, id, "reject")).rejects.toThrow(ForbiddenError);
    await expect(transitionAffiliateProduct(apiKey("operator"), id, "approve")).rejects.toThrow(/signed-in person/);

    const ok = await transitionAffiliateProduct(person(), id, "approve", "Good fit");
    expect(ok).toMatchObject({ status: "APPROVED", reviewedBy: reviewerId });
    await expect(transitionAffiliateProduct(apiKey("operator"), id, "publish")).rejects.toThrow(/signed-in person/);
    await transitionAffiliateProduct(person(), id, "publish");
    expect((await transitionAffiliateProduct(automation, id, "unpublish", "Broken image")).status).toBe("APPROVED");
    await expect(ingestAffiliateProducts(asRole(t.ctx, "viewer"), [listing("B0VIEWER02")], { source: "api", provenance: "MANUAL" })).rejects.toThrow(ForbiddenError);
  });
});

describe("editing FORGE-owned fields", () => {
  it("refuses network fields, checks the revision, and lets automations enrich only before review", async () => {
    const id = (await ingest("B0EDIT0001", { description: null })).items[0].id;
    const l = await getAffiliateProduct(t.ctx, id);
    await expect(updateAffiliateProduct(t.ctx, id, { title: "A better title" }, l.revision)).rejects.toThrow(/supplied by the network/);
    await expect(updateAffiliateProduct(t.ctx, id, { price: 1 }, l.revision)).rejects.toThrow(/supplied by the network/);
    await expect(updateAffiliateProduct(t.ctx, id, { colour: "red" }, l.revision)).rejects.toThrow(/Unknown field/);
    await expect(updateAffiliateProduct(t.ctx, id, { summary: "x" }, l.revision + 5)).rejects.toThrow(ConflictError);

    const automation = apiKey("automation");
    const enriched = await updateAffiliateProduct(automation, id, { summary: "Keeps two dishes apart.", tags: "lunch\nmeal prep", expectedCommissionRate: "4" }, l.revision);
    expect(enriched).toMatchObject({ summary: "Keeps two dishes apart.", tags: ["lunch", "meal prep"], expectedCommissionRate: 4, revision: l.revision + 1 });
    await expect(updateAffiliateProduct(automation, id, { summary: "again" }, l.revision)).rejects.toThrow(ConflictError);

    await transitionAffiliateProduct(t.ctx, id, "submit");
    await transitionAffiliateProduct(t.ctx, id, "approve");
    const approvedRow = await getAffiliateProduct(t.ctx, id);
    await expect(updateAffiliateProduct(automation, id, { summary: "late" }, approvedRow.revision)).rejects.toThrow(/before review/);
    await expect(transitionAffiliateProduct(person(), id, "publish", null, { expectedRevision: approvedRow.revision - 1 })).rejects.toThrow(ConflictError);

    const pub = await transitionAffiliateProduct(person(), id, "publish", null, { expectedRevision: approvedRow.revision });
    expect((await productRow(pub.productId!)).description).toBe("Keeps two dishes apart.");
    await updateAffiliateProduct(person(), id, { summary: "Two compartments, one lid.", categoryId: foodStorageId }, pub.revision);
    expect(await productRow(pub.productId!)).toMatchObject({ description: "Two compartments, one lid.", commissionPercentage: 4, tags: ["lunch", "meal prep"] });
  });

  it("locks network fields on the storefront product and its tracked link", async () => {
    const id = await approved("B0LOCKED01");
    const { productId } = await transitionAffiliateProduct(person(), id, "publish");
    await expect(updateProduct(t.ctx, productId!, { sellingPrice: 1 })).rejects.toThrow(/published from a network listing/);
    await expect(updateProduct(t.ctx, productId!, { title: "Renamed" })).rejects.toThrow(ValidationError);
    // Unchanged network values and FORGE research inputs are fine; a partial update keeps everything else.
    const kept = await updateProduct(t.ctx, productId!, { trendScore: 70, sellingPrice: 349 });
    expect(kept).toMatchObject({ trendScore: 70, sellingPrice: 349, currency: "EGP", businessModel: "AFFILIATE" });
    await expect(createLink(t.ctx, { productId: productId!, url: "https://example.com/elsewhere" })).rejects.toThrow(/network listing/);
  });
});

describe("tracking and reported conversions", () => {
  it("records views, outbound clicks and network-reported commission per listing — never estimated", async () => {
    const id = await approved("B0TRACK001");
    const { productId } = await transitionAffiliateProduct(person(), id, "publish");
    const link = await linkFor(id);

    const r = await handleTrackedRedirect(t.db, { code: link.code, utm: { utm_source: "instagram", utm_campaign: "eg-launch" }, userAgent: UA, ip: "198.51.100.7", appUrl: "http://localhost:3000" });
    expect(r!.destination).toBe(tagged("B0TRACK001")); // Amazon's tagged link, unmodified
    const [click] = await t.db.select().from(clickEvents).where(eq(clickEvents.id, r!.clickId!));
    expect(click).toMatchObject({ eventType: "AFFILIATE_CLICK", affiliateProductId: id, destinationHost: "www.amazon.eg", utmSource: "instagram", utmCampaign: "eg-launch" });
    await recordEvent(t.db, { orgId: t.orgId, eventType: "PAGE_VIEW", productId, userAgent: UA });

    const automation = apiKey("automation");
    const row = { network: "AMAZON_ASSOCIATES", marketplace: "www.amazon.eg", externalId: "B0TRACK001", orderId: "2026-09-12-0001", occurredAt: new Date().toISOString(), revenue: 349, commission: 17.45, currency: "EGP" };
    const first = await importListingConversions(automation, { source: "amazon_eg_report", items: [row, { ...row, externalId: "B0UNKNOWN1", orderId: "x" }, { ...row, commission: -1 }] });
    expect(first).toMatchObject({ created: 1, duplicates: 0 });
    expect(first.errors.map((e) => e.index)).toEqual([1, 2]);
    expect((await importListingConversions(automation, { source: "amazon_eg_report", items: [row] })).duplicates).toBe(1);

    const [stats] = (await affiliateTracking(t.ctx, { affiliateProductId: id })).items;
    expect(stats).toMatchObject({ views: 1, outboundClicks: 1, redirectFallbacks: 0, clickThroughRate: 1, conversions: 1, revenue: { EGP: 349 }, commission: { EGP: 17.45 } });

    // The HTTP link checker never requests Amazon pages: listing links are verified through the API refresh.
    expect((await checkLink(t.ctx, link)).error).toBe("listing");
  });
});

describe("scores, failures and the queue", () => {
  it("records scores with provenance and turns reported failures into takedowns", async () => {
    const id = await approved("B0SCORE001");
    await transitionAffiliateProduct(person(), id, "publish");
    const automation = apiKey("automation");
    await expect(scoreAffiliateProduct(automation, id, { score: 80, provenance: "REAL", source: "n8n:v1" })).rejects.toThrow(ValidationError);
    const scored = await scoreAffiliateProduct(automation, id, { score: 81.26, provenance: "AI_INFERENCE", source: "n8n:listing-score-v1", reasons: ["Clear everyday problem"] });
    expect(scored).toMatchObject({ score: 81.3, scoreProvenance: "AI_INFERENCE", scoreSource: "n8n:listing-score-v1", scoreReasons: ["Clear everyday problem"] });

    const failed = await reportAffiliateFailure(automation, id, { code: "LinkCheck", message: "Tagged link returned an error page", unpublish: true });
    expect(failed).toMatchObject({ status: "APPROVED", lastSyncError: "LinkCheck: Tagged link returned an error page" });
    expect((await affiliateFailures(t.ctx)).syncErrors.map((e) => e.id)).toContain(id);

    const errors = await listAffiliateProducts(t.ctx, { hasError: true, q: "B0SCORE001" });
    expect(errors).toMatchObject({ total: 1, items: [expect.objectContaining({ id })] });
    const byScore = await listAffiliateProducts(t.ctx, { sort: "score", limit: 1 });
    expect(byScore.items[0].id).toBe(id);
    expect((await t.db.select().from(affiliateProducts).where(eq(affiliateProducts.id, id)))[0].revision).toBeGreaterThan(1);
  });
});
