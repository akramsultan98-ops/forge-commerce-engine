import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { affiliateProducts } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { resetAmazonTokenCache } from "@/server/affiliate/amazon/client";
import { affiliateProviderStatus, discoverAffiliateProducts, getAffiliateProduct, ingestAffiliateProducts, listAffiliateProducts, refreshAffiliateProducts, transitionAffiliateProduct } from "@/server/services/affiliate-products";
import { asRole, freshDb } from "../support/db";

const AMAZON_KEYS = ["AMAZON_CREATORS_CREDENTIAL_ID", "AMAZON_CREATORS_CREDENTIAL_SECRET", "AMAZON_CREATORS_CREDENTIAL_VERSION", "AMAZON_PARTNER_TAG", "AMAZON_MARKETPLACE"];
let t: Awaited<ReturnType<typeof freshDb>>;
let secret = "";

beforeAll(async () => {
  // Random, obviously fake credentials generated per run.
  secret = crypto.randomBytes(24).toString("base64url");
  Object.assign(process.env, {
    AMAZON_CREATORS_CREDENTIAL_ID: `test-${crypto.randomBytes(6).toString("hex")}`,
    AMAZON_CREATORS_CREDENTIAL_SECRET: secret,
    AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2",
    AMAZON_PARTNER_TAG: "forgetest-21",
    AMAZON_MARKETPLACE: "www.amazon.eg",
  });
  t = await freshDb();
});
afterAll(async () => {
  for (const k of AMAZON_KEYS) delete process.env[k];
  resetEnvCache();
  await t.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetAmazonTokenCache();
});

const listing = (externalId: string, over: Record<string, unknown> = {}) => ({
  network: "AMAZON_ASSOCIATES",
  marketplace: "www.amazon.eg",
  country: "EG",
  externalId,
  title: `Test listing ${externalId}`,
  description: "A test listing description.",
  category: "Kitchen",
  productUrl: `https://www.amazon.eg/dp/${externalId}`,
  affiliateUrl: `https://www.amazon.eg/dp/${externalId}?tag=forgetest-21`,
  imageUrls: ["https://m.media-amazon.com/images/I/test.jpg"],
  price: 199,
  currency: "EGP",
  availability: "IN_STOCK",
  ...over,
});

const creatorsItem = (asin: string, price: number) => ({
  asin,
  detailPageURL: `https://www.amazon.eg/dp/${asin}?tag=forgetest-21`,
  images: { primary: { large: { url: `https://m.media-amazon.com/images/I/${asin}.jpg` } } },
  itemInfo: { title: { displayValue: `Creators item ${asin}` }, byLineInfo: { brand: { displayValue: "Acme" } } },
  offersV2: { listings: [{ isBuyBoxWinner: true, price: { money: { amount: price, currency: "EGP", displayAmount: `EGP ${price}` } }, availability: { type: "IN_STOCK" } }] },
});

/** Fake Creators API: token endpoint + the catalog operation response. */
function fakeAmazon(respond: (operation: string, body: Record<string, unknown>) => unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/o2/token")) return Response.json({ access_token: "test-token", expires_in: 3600 });
      return Response.json(respond(url.split("/").pop()!, JSON.parse(String(init?.body))));
    }),
  );
}

const rowFor = async (externalId: string) => (await t.db.select().from(affiliateProducts).where(and(eq(affiliateProducts.organizationId, t.orgId), eq(affiliateProducts.externalId, externalId))))[0];

describe("ingesting listings", () => {
  it("creates DISCOVERED listings and refreshes data without touching the review state", async () => {
    const first = await ingestAffiliateProducts(t.ctx, [listing("B0INGEST01")], { source: "n8n", provenance: "MANUAL" });
    expect(first).toMatchObject({ created: 1, updated: 0, errors: [] });
    expect(first.items[0].status).toBe("DISCOVERED");
    await transitionAffiliateProduct(t.ctx, first.items[0].id, "submit", "Looks promising");
    const second = await ingestAffiliateProducts(t.ctx, [listing("B0INGEST01", { price: 149 })], { source: "provider", provenance: "REAL" });
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(await rowFor("B0INGEST01")).toMatchObject({ price: 149, status: "REVIEW", reviewNote: "Looks promising", ingestSource: "n8n", provenance: "REAL" });
  });

  it("rejects invalid listings with a reason per item and keeps the valid ones", async () => {
    const r = await ingestAffiliateProducts(t.ctx, [listing("B0INGEST02", { rating: 4.5 }), listing("B0INGEST03", { affiliateUrl: "http://insecure.example" }), { title: "" }, listing("B0INGEST04")], { source: "api", provenance: "MANUAL" });
    expect(r.created).toBe(1);
    expect(r.errors.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(r.errors[0].message).toMatch(/reviewSource/);
    expect(r.errors[1].message).toMatch(/https/);
  });
});

describe("review lifecycle", () => {
  it("walks DISCOVERED → REVIEW → APPROVED → PUBLISHED → ARCHIVED → REVIEW", async () => {
    const { items } = await ingestAffiliateProducts(t.ctx, [listing("B0FLOW0001")], { source: "api", provenance: "MANUAL" });
    const id = items[0].id;
    await transitionAffiliateProduct(t.ctx, id, "submit");
    await transitionAffiliateProduct(t.ctx, id, "approve", "Fits the kitchen range");
    const published = await transitionAffiliateProduct(t.ctx, id, "publish");
    expect(published).toMatchObject({ status: "PUBLISHED", fresh: true, maxDataAgeHours: 24, allowedActions: ["unpublish", "archive"] });
    await expect(transitionAffiliateProduct(t.ctx, id, "approve")).rejects.toThrow(ConflictError);
    await expect(transitionAffiliateProduct(t.ctx, id, "explode")).rejects.toThrow(ValidationError);
    await transitionAffiliateProduct(t.ctx, id, "archive");
    expect((await transitionAffiliateProduct(t.ctx, id, "restore")).status).toBe("REVIEW");
  });

  it("refuses to publish stale data or a listing without an affiliate link", async () => {
    const { items } = await ingestAffiliateProducts(t.ctx, [listing("B0STALE001")], { source: "api", provenance: "MANUAL" });
    const id = items[0].id;
    await transitionAffiliateProduct(t.ctx, id, "submit");
    await transitionAffiliateProduct(t.ctx, id, "approve");
    await t.db.update(affiliateProducts).set({ dataFetchedAt: new Date(Date.now() - 30 * 3_600_000) }).where(eq(affiliateProducts.id, id));
    await expect(transitionAffiliateProduct(t.ctx, id, "publish")).rejects.toThrow(/older than 24 hours/);
    await ingestAffiliateProducts(t.ctx, [listing("B0STALE001", { affiliateUrl: null })], { source: "api", provenance: "MANUAL" });
    await expect(transitionAffiliateProduct(t.ctx, id, "publish")).rejects.toThrow(/affiliate URL/);
    expect((await getAffiliateProduct(t.ctx, id)).status).toBe("APPROVED");
  });

  it("lets viewers read but not change listings", async () => {
    const viewer = asRole(t.ctx, "viewer");
    const [row] = await t.db.select().from(affiliateProducts).limit(1);
    await expect(ingestAffiliateProducts(viewer, [listing("B0VIEWER01")], { source: "api", provenance: "MANUAL" })).rejects.toThrow(ForbiddenError);
    await expect(transitionAffiliateProduct(viewer, row.id, "archive")).rejects.toThrow(ForbiddenError);
    expect((await listAffiliateProducts(viewer)).items.length).toBeGreaterThan(0);
  });
});

describe("Amazon through the Creators API", () => {
  it("discovers listings and stores them as REAL, provider-sourced data", async () => {
    fakeAmazon(() => ({ searchResult: { items: [creatorsItem("B0DISCOV01", 250), creatorsItem("B0DISCOV02", 90)] } }));
    const r = await discoverAffiliateProducts(t.ctx, { keywords: "silicone lids", limit: 2 });
    expect(r).toMatchObject({ network: "AMAZON_ASSOCIATES", marketplace: "www.amazon.eg", found: 2, created: 2, errors: [] });
    expect(await rowFor("B0DISCOV01")).toMatchObject({ status: "DISCOVERED", provenance: "REAL", ingestSource: "provider", price: 250, currency: "EGP", brand: "Acme" });
    expect((await discoverAffiliateProducts(t.ctx, { keywords: "silicone lids", limit: 2 })).updated).toBe(2);
  });

  it("refreshes stale listings and flags the ones Amazon no longer returns", async () => {
    await t.db.update(affiliateProducts).set({ dataFetchedAt: new Date(Date.now() - 23 * 3_600_000) }).where(eq(affiliateProducts.network, "AMAZON_ASSOCIATES"));
    fakeAmazon((_op, body) => {
      const ids = body.itemIds as string[];
      return { itemsResult: { items: ids.includes("B0DISCOV01") ? [creatorsItem("B0DISCOV01", 199)] : [] }, errors: ids.includes("B0DISCOV02") ? [{ code: "ItemNotAccessible", message: "The ItemId B0DISCOV02 is not accessible through the Creators API." }] : [] };
    });
    const r = await refreshAffiliateProducts(t.ctx, { olderThanHours: 20 });
    expect(r.checked).toBeGreaterThanOrEqual(2);
    expect(r.failed).toEqual(expect.arrayContaining([expect.objectContaining({ externalId: "B0DISCOV02", code: "ItemNotAccessible" })]));
    const refreshed = await rowFor("B0DISCOV01");
    expect(refreshed.price).toBe(199);
    expect(Date.now() - refreshed.dataFetchedAt!.getTime()).toBeLessThan(60_000);
    expect((await rowFor("B0DISCOV02")).lastSyncError).toMatch(/ItemNotAccessible/);
  });

  it("filters stale listings for the refresh queue", async () => {
    const stale = await listAffiliateProducts(t.ctx, { stale: true });
    expect(stale.items.every((i) => !i.fresh)).toBe(true);
    const fresh = await listAffiliateProducts(t.ctx, { stale: false, network: "AMAZON_ASSOCIATES" });
    expect(fresh.items.every((i) => i.fresh)).toBe(true);
  });

  it("reports provider readiness without exposing credentials", () => {
    const [amazon] = affiliateProviderStatus();
    expect(amazon).toMatchObject({ network: "AMAZON_ASSOCIATES", configured: true, missing: [], maxDataAgeHours: 24, marketplaces: [expect.objectContaining({ id: "www.amazon.eg", country: "EG", currency: "EGP" })] });
    expect(JSON.stringify(amazon)).not.toContain(secret);
  });
});
