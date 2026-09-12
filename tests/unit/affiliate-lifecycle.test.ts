import { describe, expect, it } from "vitest";
import { AFFILIATE_PRODUCT_STATUSES } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { ACTION_PERMISSION, AFFILIATE_ACTIONS, HUMAN_ONLY_ACTIONS, PROVIDER_OWNED_PRODUCT_FIELDS, allowedActions, dataAgeHours, dataExpiresAt, isDataFresh, nextStatus, publishBlockers } from "@/domain/affiliate-products";

const hoursAgo = (h: number, now: Date) => new Date(now.getTime() - h * 3_600_000);

describe("affiliate product lifecycle", () => {
  it("follows DISCOVERED → REVIEW → APPROVED → PUBLISHED → ARCHIVED", () => {
    expect(nextStatus("DISCOVERED", "submit")).toBe("REVIEW");
    expect(nextStatus("REVIEW", "approve")).toBe("APPROVED");
    expect(nextStatus("APPROVED", "publish")).toBe("PUBLISHED");
    expect(nextStatus("PUBLISHED", "archive")).toBe("ARCHIVED");
  });

  it("supports rejecting, unpublishing and restoring", () => {
    expect(nextStatus("REVIEW", "reject")).toBe("REJECTED");
    expect(nextStatus("PUBLISHED", "unpublish")).toBe("APPROVED");
    expect(nextStatus("REJECTED", "restore")).toBe("REVIEW");
    expect(nextStatus("ARCHIVED", "restore")).toBe("REVIEW");
  });

  it("refuses shortcuts and illegal moves", () => {
    expect(nextStatus("DISCOVERED", "publish")).toBeNull();
    expect(nextStatus("DISCOVERED", "approve")).toBeNull();
    expect(nextStatus("PUBLISHED", "reject")).toBeNull();
    expect(nextStatus("ARCHIVED", "publish")).toBeNull();
  });

  it("lists the actions each status allows (every status has a way forward or back)", () => {
    expect(allowedActions("APPROVED")).toEqual(["reject", "publish", "archive"]);
    expect(allowedActions("PUBLISHED")).toEqual(["unpublish", "archive"]);
    for (const s of AFFILIATE_PRODUCT_STATUSES) expect(allowedActions(s).length).toBeGreaterThan(0);
  });
});

describe("who may take each action", () => {
  it("lets machines prepare and protect listings, and keeps decisions with people", () => {
    expect(HUMAN_ONLY_ACTIONS).toEqual(["approve", "publish"]);
    for (const a of HUMAN_ONLY_ACTIONS) expect(ACTION_PERMISSION[a]).toBe("affiliate:review");
    for (const a of AFFILIATE_ACTIONS) expect(can("operator", ACTION_PERMISSION[a])).toBe(true);
    expect(can("automation", ACTION_PERMISSION.submit)).toBe(true);
    expect(can("automation", ACTION_PERMISSION.unpublish)).toBe(true);
    expect(can("automation", ACTION_PERMISSION.archive)).toBe(true);
    for (const a of ["approve", "publish", "reject", "restore"] as const) expect(can("automation", ACTION_PERMISSION[a])).toBe(false);
  });

  it("confines the automation role to the listing pipeline", () => {
    expect(can("automation", "affiliate:read")).toBe(true);
    expect(can("automation", "affiliate:ingest")).toBe(true);
    for (const p of ["affiliate:review", "affiliate:write", "products:read", "products:write", "settings:read", "apikeys:manage", "dashboard:read"] as const) expect(can("automation", p)).toBe(false);
    expect(can("viewer", "affiliate:ingest")).toBe(false);
    expect(can("viewer", "affiliate:review")).toBe(false);
  });
});

describe("data freshness (Amazon: at most 24 hours)", () => {
  const now = new Date("2026-09-12T12:00:00Z");

  it("measures age and applies the network's limit", () => {
    expect(dataAgeHours(hoursAgo(6, now), now)).toBeCloseTo(6);
    expect(dataAgeHours(null, now)).toBeNull();
    expect(isDataFresh(hoursAgo(23, now), 24, now)).toBe(true);
    expect(isDataFresh(hoursAgo(25, now), 24, now)).toBe(false);
    expect(isDataFresh(null, 24, now)).toBe(false);
    expect(isDataFresh(null, null, now)).toBe(true); // networks without a freshness rule
  });

  it("computes when displayed data must disappear", () => {
    expect(dataExpiresAt(new Date("2026-09-12T00:00:00Z"), 24)?.toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(dataExpiresAt(new Date(), null)).toBeNull();
    expect(dataExpiresAt(null, 24)!.getTime()).toBeLessThan(now.getTime()); // never fetched = already expired
  });

  it("explains why a listing cannot be published", () => {
    const ready = {
      affiliateUrl: "https://www.amazon.eg/dp/B000000001?tag=forgetest-21",
      productUrl: "https://www.amazon.eg/dp/B000000001",
      imageUrls: ["https://m.media-amazon.com/images/I/test.jpg"],
      description: null,
      summary: "A FORGE summary",
      category: "Food Storage",
      categoryId: null,
      availability: "IN_STOCK",
      dataFetchedAt: hoursAgo(1, now),
    };
    expect(publishBlockers(ready, 24, now)).toEqual([]);
    expect(publishBlockers({ ...ready, dataFetchedAt: hoursAgo(30, now) }, 24, now).join()).toMatch(/older than 24 hours/);
    expect(publishBlockers({ ...ready, affiliateUrl: null }, 24, now).join()).toMatch(/affiliate URL/);
    expect(publishBlockers({ ...ready, availability: "OUT_OF_STOCK" }, 24, now).join()).toMatch(/out of stock/);
    expect(publishBlockers({ ...ready, productUrl: null }, 24, now).join()).toMatch(/product URL/);
    expect(publishBlockers({ ...ready, imageUrls: [] }, 24, now).join()).toMatch(/no image/);
    expect(publishBlockers({ ...ready, summary: "  " }, 24, now).join()).toMatch(/description/);
    expect(publishBlockers({ ...ready, summary: null, description: "From the network" }, 24, now)).toEqual([]);
    expect(publishBlockers({ ...ready, category: null }, 24, now).join()).toMatch(/category/);
    expect(publishBlockers({ ...ready, category: null, categoryId: "c1" }, 24, now)).toEqual([]);
  });

  it("marks the storefront fields a network listing owns", () => {
    for (const f of ["title", "sellingPrice", "currency", "affiliateUrl", "productUrl", "imageUrl"]) expect(PROVIDER_OWNED_PRODUCT_FIELDS).toContain(f);
    expect(PROVIDER_OWNED_PRODUCT_FIELDS).not.toContain("trendScore");
  });
});
