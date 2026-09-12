import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/server/env";
import { IntegrationNotConfiguredError, ValidationError } from "@/server/errors";
import { amazonConfig, amazonConfigStatus } from "@/server/affiliate/amazon/config";
import { AmazonApiError, resetAmazonTokenCache } from "@/server/affiliate/amazon/client";
import { AMAZON_MARKETPLACES } from "@/server/affiliate/amazon/marketplaces";
import { CREATORS_RESOURCES, amazonProvider, mapAvailability, normalizeAmazonItem, type CreatorsItem } from "@/server/affiliate/amazon/provider";

const KEYS = ["AMAZON_CREATORS_CREDENTIAL_ID", "AMAZON_CREATORS_CREDENTIAL_SECRET", "AMAZON_CREATORS_CREDENTIAL_VERSION", "AMAZON_PARTNER_TAG", "AMAZON_MARKETPLACE"] as const;
type Key = (typeof KEYS)[number];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const EG = AMAZON_MARKETPLACES["www.amazon.eg"];

// Random, obviously fake values generated per run — never a real or hardcoded credential.
let credentialId = "";
let secret = "";
function configure(over: Partial<Record<Key, string>> = {}) {
  credentialId = `test-${crypto.randomBytes(6).toString("hex")}`;
  secret = crypto.randomBytes(24).toString("base64url");
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, { AMAZON_CREATORS_CREDENTIAL_ID: credentialId, AMAZON_CREATORS_CREDENTIAL_SECRET: secret, AMAZON_CREATORS_CREDENTIAL_VERSION: "2.2", AMAZON_PARTNER_TAG: "forgetest-21", AMAZON_MARKETPLACE: "www.amazon.eg", ...over });
  resetEnvCache();
  resetAmazonTokenCache();
}
function unconfigure() {
  for (const k of KEYS) delete process.env[k];
  resetEnvCache();
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else Object.assign(process.env, { [k]: saved[k] });
  }
  resetEnvCache();
  resetAmazonTokenCache();
  vi.unstubAllGlobals();
});

type Call = { url: string; headers: Record<string, string>; body: string };
/** Fake Creators API (token endpoints + catalog operations). No network. */
function fakeAmazon(respond: (operation: string, body: Record<string, unknown>, n: number) => { status?: number; json?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  let operations = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body ?? "") });
      if (/\/oauth2\/token$|\/auth\/o2\/token$/.test(url)) return Response.json({ access_token: `token-${calls.length}`, expires_in: 3600, token_type: "bearer" });
      const r = respond(url.split("/").pop()!, JSON.parse(String(init?.body)), ++operations);
      return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
    }),
  );
  return calls;
}

const asin = (n: number) => `B0${String(n).padStart(8, "0")}`;
const item = (id: string, over: Partial<CreatorsItem> = {}): CreatorsItem => ({
  asin: id,
  parentASIN: "B0PARENT01",
  detailPageURL: `https://www.amazon.eg/dp/${id}?tag=forgetest-21&linkCode=ogi`,
  images: {
    primary: { large: { url: `https://m.media-amazon.com/images/I/${id}.jpg` } },
    variants: [{ large: { url: "https://m.media-amazon.com/images/I/variant.jpg" } }, { large: { url: "http://insecure.example/x.jpg" } }],
  },
  itemInfo: {
    title: { displayValue: "Silicone Stretch Lids, 6 Pack" },
    byLineInfo: { brand: { displayValue: "Acme" } },
    features: { displayValues: ["Food-safe silicone", "Dishwasher safe"] },
    classifications: { productGroup: { displayValue: "Kitchen" } },
  },
  offersV2: { listings: [{ isBuyBoxWinner: true, price: { money: { amount: 349.5, currency: "EGP", displayAmount: "EGP 349.50" } }, availability: { type: "IN_STOCK", message: "In stock" }, merchantInfo: { name: "Amazon.eg" } }] },
  browseNodeInfo: { browseNodes: [{ displayName: "Lids", salesRank: 42, ancestor: { displayName: "Food Storage", ancestor: { displayName: "Kitchen & Dining" } } }] },
  ...over,
});

describe("Amazon configuration (server-only, names never values)", () => {
  it("lists exactly which variables are missing", () => {
    unconfigure();
    const s = amazonConfigStatus();
    expect(s.configured).toBe(false);
    expect(s.missing).toEqual(["AMAZON_CREATORS_CREDENTIAL_ID", "AMAZON_CREATORS_CREDENTIAL_SECRET", "AMAZON_CREATORS_CREDENTIAL_VERSION", "AMAZON_PARTNER_TAG"]);
    expect(s.marketplace).toBe("www.amazon.eg");
    expect(() => amazonConfig()).toThrow(IntegrationNotConfiguredError);
  });

  it("accepts a complete Amazon.eg configuration", () => {
    configure();
    expect(amazonConfigStatus()).toMatchObject({ configured: true, missing: [], problems: [], warnings: [] });
    expect(amazonConfig().marketplace).toBe(EG);
  });

  it.each([
    [{ AMAZON_CREATORS_CREDENTIAL_VERSION: "9.9" }, /must be one of 2\.1, 2\.2, 2\.3, 3\.1, 3\.2, 3\.3/],
    [{ AMAZON_PARTNER_TAG: "not a tag" }, /does not look like an Associates tracking tag/],
    [{ AMAZON_MARKETPLACE: "www.amazon.xx" }, /is not supported/],
  ])("reports problems for %j", (over, problem) => {
    configure(over);
    const s = amazonConfigStatus();
    expect(s.configured).toBe(false);
    expect(s.problems.join()).toMatch(problem);
  });

  it("warns (without blocking) about a tag or credential region that looks wrong for Egypt", () => {
    configure({ AMAZON_PARTNER_TAG: "forgetest-20", AMAZON_CREATORS_CREDENTIAL_VERSION: "3.1" });
    const s = amazonConfigStatus();
    expect(s.configured).toBe(true);
    expect(s.warnings.join()).toMatch(/end in -21/);
    expect(s.warnings.join()).toMatch(/NA region/);
  });

  it("rejects whitespace in secrets and never echoes a value", () => {
    configure({ AMAZON_CREATORS_CREDENTIAL_SECRET: ` ${crypto.randomBytes(12).toString("hex")} ` });
    const bad = process.env.AMAZON_CREATORS_CREDENTIAL_SECRET!.trim();
    const s = amazonConfigStatus();
    expect(s.problems.join()).toMatch(/AMAZON_CREATORS_CREDENTIAL_SECRET has leading or trailing whitespace/);
    let details = "";
    try {
      amazonConfig();
    } catch (err) {
      details = JSON.stringify((err as IntegrationNotConfiguredError).details);
    }
    expect(JSON.stringify(s) + details).not.toContain(bad);
    expect(JSON.stringify(s) + details).not.toContain(credentialId);
  });

  it("only serves the marketplace the Associates tag belongs to", () => {
    configure();
    const err = (() => {
      try {
        amazonConfig("www.amazon.com");
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(IntegrationNotConfiguredError);
    expect((err as IntegrationNotConfiguredError).requirements.join()).toMatch(/www\.amazon\.com needs its own Associates account/);
  });
});

describe("Creators API client", () => {
  it("uses the Cognito flow for v2.x credentials and signs catalog calls with the version", async () => {
    configure({ AMAZON_CREATORS_CREDENTIAL_VERSION: "2.2" });
    const calls = fakeAmazon(() => ({ json: { searchResult: { items: [item(asin(1))] } } }));
    const r = await amazonProvider.search({ keywords: "silicone lids", limit: 50 });
    expect(r.items).toHaveLength(1);
    const [token, search] = calls;
    expect(token.url).toBe("https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token");
    expect(token.headers.authorization).toBe(`Basic ${Buffer.from(`${credentialId}:${secret}`).toString("base64")}`);
    expect(Object.fromEntries(new URLSearchParams(token.body))).toEqual({ grant_type: "client_credentials", scope: "creatorsapi/default" });
    expect(search.url).toBe("https://creatorsapi.amazon/catalog/v1/searchItems");
    expect(search.headers.authorization).toBe("Bearer token-1, Version 2.2");
    expect(search.headers["x-marketplace"]).toBe("www.amazon.eg");
    const body = JSON.parse(search.body);
    expect(body).toMatchObject({ keywords: "silicone lids", searchIndex: "All", itemCount: 10, itemPage: 1, partnerTag: "forgetest-21", marketplace: "www.amazon.eg", languagesOfPreference: ["en_AE"] });
    expect(body.resources).toEqual([...CREATORS_RESOURCES]);
    expect(body.resources.join()).not.toMatch(/customerReviews/);
  });

  it("uses Login with Amazon for v3.x credentials and caches the token", async () => {
    configure({ AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2" });
    const calls = fakeAmazon(() => ({ json: { searchResult: { items: [] } } }));
    await amazonProvider.search({ keywords: "lids" });
    await amazonProvider.search({ keywords: "lids" });
    expect(calls.map((c) => c.url)).toEqual(["https://api.amazon.co.uk/auth/o2/token", "https://creatorsapi.amazon/catalog/v1/searchItems", "https://creatorsapi.amazon/catalog/v1/searchItems"]);
    expect(JSON.parse(calls[0].body)).toEqual({ grant_type: "client_credentials", client_id: credentialId, client_secret: secret, scope: "creatorsapi::default" });
    expect(calls[1].headers.authorization).toBe("Bearer token-1");
  });

  it("gets a fresh token once when Amazon answers 401", async () => {
    configure();
    const calls = fakeAmazon((_op, _body, n) => (n === 1 ? { status: 401, json: { message: "expired" } } : { json: { searchResult: { items: [] } } }));
    await amazonProvider.search({ keywords: "lids" });
    expect(calls.filter((c) => c.url.includes("/oauth2/token"))).toHaveLength(2);
  });

  it("surfaces throttling and upstream errors without leaking credentials", async () => {
    configure();
    fakeAmazon(() => ({ status: 429, json: {}, headers: { "retry-after": "7" } }));
    const throttled = await amazonProvider.search({ keywords: "lids" }).catch((e) => e);
    expect(throttled).toBeInstanceOf(AmazonApiError);
    expect(throttled).toMatchObject({ status: 429, code: "amazon_throttled", upstream: { retryAfterSeconds: 7 } });

    resetAmazonTokenCache();
    fakeAmazon(() => ({ status: 400, json: { errors: [{ code: "InvalidParameterValue", message: "bad keywords" }] } }));
    const failed = await amazonProvider.search({ keywords: "lids" }).catch((e) => e);
    expect(failed).toMatchObject({ status: 502, code: "amazon_api_error" });
    expect(failed.message).toMatch(/InvalidParameterValue/);
    expect(JSON.stringify({ message: failed.message, details: failed.details })).not.toContain(secret);
  });

  it("reports rejected credentials clearly", async () => {
    configure({ AMAZON_CREATORS_CREDENTIAL_VERSION: "3.2" });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_client" }, { status: 401 })));
    const err = await amazonProvider.search({ keywords: "lids" }).catch((e) => e);
    expect(err).toBeInstanceOf(AmazonApiError);
    expect(err.message).toMatch(/invalid_client/);
    expect(err.message).not.toContain(secret);
  });

  it("validates searches before calling Amazon", async () => {
    configure();
    const calls = fakeAmazon(() => ({ json: {} }));
    await expect(amazonProvider.search({ keywords: "a" })).rejects.toThrow(ValidationError);
    await expect(amazonProvider.search({ keywords: "lids", category: "Nope" })).rejects.toThrow(/Unknown category/);
    expect(calls).toHaveLength(0);
  });

  it("gets items in batches of 10 and reports every ASIN it could not return", async () => {
    configure();
    const ids = Array.from({ length: 11 }, (_, i) => asin(i + 1));
    const calls = fakeAmazon((op, body, n) => {
      const requested = body.itemIds as string[];
      if (n === 1) return { json: { itemsResult: { items: requested.slice(0, 9).map((id) => item(id)) }, errors: [{ code: "ItemNotAccessible", message: `The ItemId ${requested[9]} is not accessible through the Creators API.` }] } };
      return { json: { itemResults: { items: [] } } };
    });
    const r = await amazonProvider.getItems("www.amazon.eg", [...ids, "bad"]);
    expect(calls.filter((c) => c.url.endsWith("/getItems"))).toHaveLength(2);
    expect(r.items).toHaveLength(9);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { id: "BAD", code: "InvalidASIN", message: "Not a valid ASIN" },
        expect.objectContaining({ id: ids[9], code: "ItemNotAccessible" }),
        { id: ids[10], code: "NotReturned", message: "Amazon returned no data for this ASIN" },
      ]),
    );
  });
});

describe("normalising Creators API items", () => {
  const now = new Date("2026-09-12T12:00:00Z");

  it("maps an item onto the network-agnostic listing", () => {
    const n = normalizeAmazonItem(item(asin(1)), EG, now)!;
    expect(n).toMatchObject({
      network: "AMAZON_ASSOCIATES",
      marketplace: "www.amazon.eg",
      country: "EG",
      externalId: asin(1),
      externalIdType: "ASIN",
      parentExternalId: "B0PARENT01",
      merchant: "Amazon.eg",
      title: "Silicone Stretch Lids, 6 Pack",
      brand: "Acme",
      features: ["Food-safe silicone", "Dishwasher safe"],
      category: "Lids",
      categoryPath: ["Kitchen & Dining", "Food Storage", "Lids"],
      productUrl: `https://www.amazon.eg/dp/${asin(1)}`,
      price: 349.5,
      currency: "EGP",
      priceDisplay: "EGP 349.50",
      availability: "IN_STOCK",
      rating: null,
      reviewCount: null,
      provenance: "REAL",
      fetchedAt: now,
    });
    expect(n.affiliateUrl).toMatch(/^https:\/\/www\.amazon\.eg\/dp\/B000000001\?tag=forgetest-21/);
    expect(n.imageUrls).toEqual([`https://m.media-amazon.com/images/I/${asin(1)}.jpg`, "https://m.media-amazon.com/images/I/variant.jpg"]);
  });

  it("drops links to other hosts, prices without a currency and items without a title", () => {
    const n = normalizeAmazonItem(item(asin(2), { detailPageURL: "https://evil.example/dp/x", offersV2: { listings: [{ price: { amount: 10 } }] } }), EG, now)!;
    expect(n.affiliateUrl).toBeNull();
    expect(n.price).toBeNull();
    expect(normalizeAmazonItem(item(asin(3), { itemInfo: {} }), EG, now)).toBeNull();
    expect(normalizeAmazonItem(item("not-an-asin"), EG, now)).toBeNull();
  });

  it.each([
    ["IN_STOCK", "IN_STOCK"],
    ["OUT_OF_STOCK", "OUT_OF_STOCK"],
    ["PREORDER", "PREORDER"],
    ["AVAILABLE_DATE", "PREORDER"],
    ["LEADTIME", "BACKORDER"],
    [null, "UNKNOWN"],
    ["SOMETHING_NEW", "UNKNOWN"],
  ])("maps availability %s → %s", (type, expected) => {
    expect(mapAvailability(type)).toBe(expected);
  });
});
