import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { integrations, orders, organizations, products } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { encryptJson } from "@/server/security/crypto";
import { ensureShopifyWebhooks, handleShopifyWebhook, syncShopifyOrders } from "@/server/integrations/shopify";
import { lineOutcome, normalizeRestOrder, upsertShopifyOrder, type GraphqlOrderNode } from "@/server/integrations/shopify-orders";
import { kpis } from "@/server/services/analytics";
import { createProduct } from "@/server/services/products";
import { POST as shopifyWebhook } from "@/app/api/webhooks/shopify/route";
import { freshDb, sampleProduct } from "../support/db";

const SHOP_A = "a-store.myshopify.com";
const SHOP_B = "b-store.myshopify.com";
const SOLO = "solo.myshopify.com";
const PA = "gid://shopify/Product/11";
const PB = "gid://shopify/Product/22";
const RANGE = { from: new Date("2026-08-01T00:00:00Z"), to: new Date("2026-10-01T00:00:00Z") };

let t: Awaited<ReturnType<typeof freshDb>>;
let orgB: string;

beforeAll(async () => {
  Object.assign(process.env, { SHOPIFY_CLIENT_SECRET: "app-secret", SHOPIFY_WEBHOOK_SECRET: "store-secret", SHOPIFY_SHOP_DOMAIN: SOLO });
  t = await freshDb();
  const a = await createProduct(t.ctx, sampleProduct({ title: "Cable Clips" }));
  const b = await createProduct(t.ctx, sampleProduct({ title: "Desk Shelf", cost: 10, shippingCost: 3, sellingPrice: 30 }));
  await t.db.update(products).set({ shopifyProductId: PA }).where(eq(products.id, a.id));
  await t.db.update(products).set({ shopifyProductId: PB }).where(eq(products.id, b.id));
  const [ob] = await t.db.insert(organizations).values({ name: "Org B", slug: "org-b" }).returning();
  orgB = ob.id;
  const creds = encryptJson({ accessToken: "shpat_test_token" });
  await t.db.insert(integrations).values([
    { organizationId: t.orgId, kind: "SHOPIFY", status: "CONNECTED", config: { shop: SHOP_A }, credentialsEncrypted: creds },
    { organizationId: orgB, kind: "SHOPIFY", status: "CONNECTED", config: { shop: SHOP_B }, credentialsEncrypted: creds },
  ]);
});
afterAll(async () => t.close());
afterEach(() => {
  Object.assign(process.env, { DEMO_MODE: "true", APP_URL: "http://localhost:3000" });
  resetEnvCache();
  vi.unstubAllGlobals();
});

const restOrder = (over: Record<string, unknown> = {}) => ({
  id: 1001,
  admin_graphql_api_id: "gid://shopify/Order/1001",
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  currency: "USD",
  financial_status: "paid",
  cancelled_at: null,
  landing_site: "/products/cable-clips?utm_source=tiktok&utm_campaign=cable-clips&utm_content=hook-1",
  shipping_address: { country_code: "gb" },
  line_items: [
    { id: 1, product_id: 11, quantity: 2, current_quantity: 2, price: "12.99", price_set: { shop_money: { amount: "12.99" } }, discount_allocations: [{ amount: "2.00", amount_set: { shop_money: { amount: "2.00" } } }] },
    { id: 2, product_id: 22, quantity: 1, current_quantity: 1, price: "30.00", discount_allocations: [] },
    { id: 3, product_id: null, quantity: 1, current_quantity: 1, price: "5.00", discount_allocations: [] },
  ],
  refunds: [],
  ...over,
});

const rowsFor = (orgId: string, orderGid: string) =>
  t.db.select().from(orders).where(and(eq(orders.organizationId, orgId), eq(orders.externalOrderId, orderGid))).orderBy(orders.externalLineId);

const money = (amount: number) => ({ shopMoney: { amount: amount.toFixed(2) } });
const gqlOrder = (over: Partial<GraphqlOrderNode> = {}): GraphqlOrderNode => ({
  id: "gid://shopify/Order/3003",
  createdAt: "2026-09-02T09:00:00Z",
  updatedAt: "2026-09-03T09:00:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PARTIALLY_REFUNDED",
  currencyCode: "USD",
  customerJourneySummary: { lastVisit: { utmParameters: { source: "pinterest", campaign: "clips", content: null } } },
  lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ id: "gid://shopify/LineItem/31", quantity: 3, currentQuantity: 2, product: { id: PA }, originalTotalSet: money(38.97), discountAllocations: [] }] },
  refunds: [{ refundLineItems: { nodes: [{ lineItem: { id: "gid://shopify/LineItem/31" }, quantity: 1, subtotalSet: money(12.99) }] } }],
  ...over,
});

/** Fake Shopify Admin GraphQL endpoint (fetch stub) — no network. */
function fakeShopify(opts: { orders?: GraphqlOrderNode[]; existingHooks?: Array<{ topic: string; uri: string }> } = {}) {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fn = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { query: string; variables: Record<string, unknown> };
    calls.push(body);
    let data: unknown;
    if (body.query.includes("ForgeWebhooks")) data = { webhookSubscriptions: { nodes: opts.existingHooks ?? [] } };
    else if (body.query.includes("ForgeWebhookCreate")) {
      const input = body.variables.webhookSubscription as { uri: string };
      data = { webhookSubscriptionCreate: { webhookSubscription: { id: "gid://shopify/WebhookSubscription/1", topic: body.variables.topic, uri: input.uri }, userErrors: [] } };
    } else if (body.query.includes("ForgeOrderIds")) data = { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: (opts.orders ?? []).map((o) => ({ id: o.id })) } };
    else if (body.query.includes("ForgeOrder(")) data = { order: (opts.orders ?? []).find((o) => o.id === body.variables.id) ?? null };
    else throw new Error(`unexpected Shopify query: ${body.query.slice(0, 60)}`);
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

function liveMode(appUrl = "https://forge.example") {
  Object.assign(process.env, { DEMO_MODE: "false", APP_URL: appUrl });
  resetEnvCache();
}

describe("order normalisation", () => {
  it("credits revenue per line after discounts and refunds", () => {
    const o = normalizeRestOrder(restOrder());
    expect(o.lines.map((l) => [l.lineId, l.productGid, l.gross])).toEqual([
      ["gid://shopify/LineItem/1", PA, 23.98],
      ["gid://shopify/LineItem/2", PB, 30],
      ["gid://shopify/LineItem/3", null, 5],
    ]);
    expect(o).toMatchObject({ country: "GB", utm: { source: "tiktok", campaign: "cable-clips", content: "hook-1" }, financialStatus: "paid" });
    const line = { ...o.lines[0], refundedQuantity: 1, refunded: 11.99, currentQuantity: 1 };
    expect(lineOutcome(o, line)).toEqual({ status: "PARTIALLY_REFUNDED", quantity: 1, revenue: 11.99, refunded: 11.99 });
    expect(lineOutcome({ ...o, financialStatus: "pending" }, o.lines[0]).status).toBe("PENDING");
    expect(lineOutcome({ ...o, cancelled: true }, o.lines[0]).status).toBe("CANCELLED");
  });
});

describe("order webhooks → line-level orders", () => {
  const ORDER = "gid://shopify/Order/1001";

  it("stores one row per line item with product, cost and attribution", async () => {
    const r = await handleShopifyWebhook(t.db, "orders/create", SHOP_A, restOrder());
    expect(r).toMatchObject({ order: { lines: 3, created: 3, updated: 0 } });
    const rows = await rowsFor(t.orgId, ORDER);
    expect(rows.map((x) => [x.revenue, x.quantity, x.cost, x.shippingCost, x.status])).toEqual([
      [23.98, 2, 4.2, 3.6, "PAID"],
      [30, 1, 10, 3, "PAID"],
      [5, 1, 0, 0, "PAID"],
    ]);
    expect(rows[0]).toMatchObject({ utmSource: "tiktok", country: "GB", currency: "USD" });
    const k = await kpis(t.ctx, RANGE);
    expect(k).toMatchObject({ orders: 1, orderRevenue: 58.98, orderCost: 20.8 });
  });

  it("is idempotent on replay", async () => {
    const r = await handleShopifyWebhook(t.db, "orders/create", SHOP_A, restOrder());
    expect(r).toMatchObject({ order: { created: 0, updated: 3 } });
    expect(await rowsFor(t.orgId, ORDER)).toHaveLength(3);
  });

  it("applies refunds in place instead of adding rows", async () => {
    const refunded = restOrder({
      updated_at: "2026-09-02T10:00:00Z",
      financial_status: "partially_refunded",
      refunds: [{ id: 77, refund_line_items: [{ line_item_id: 1, quantity: 1, subtotal: "11.99", subtotal_set: { shop_money: { amount: "11.99" } } }] }],
      line_items: restOrder().line_items.map((li) => (li.id === 1 ? { ...li, current_quantity: 1 } : li)),
    });
    await handleShopifyWebhook(t.db, "orders/updated", SHOP_A, refunded);
    const rows = await rowsFor(t.orgId, ORDER);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ status: "PARTIALLY_REFUNDED", quantity: 1, revenue: 11.99, refundedAmount: 11.99, cost: 2.1, shippingCost: 1.8 });
    expect((await kpis(t.ctx, RANGE)).orderRevenue).toBe(46.99);
  });

  it("ignores an older delivery that arrives late", async () => {
    const r = await handleShopifyWebhook(t.db, "orders/create", SHOP_A, restOrder());
    expect(r).toMatchObject({ order: { stale: true } });
    expect((await rowsFor(t.orgId, ORDER))[0]).toMatchObject({ status: "PARTIALLY_REFUNDED", revenue: 11.99 });
  });

  it("drops cancelled orders out of revenue and order counts", async () => {
    await handleShopifyWebhook(t.db, "orders/cancelled", SHOP_A, restOrder({ updated_at: "2026-09-03T10:00:00Z", cancelled_at: "2026-09-03T10:00:00Z", financial_status: "refunded" }));
    expect((await rowsFor(t.orgId, ORDER)).every((r) => r.status === "CANCELLED")).toBe(true);
    expect(await kpis(t.ctx, RANGE)).toMatchObject({ orders: 0, orderRevenue: 0 });
  });

  it("replaces legacy whole-order rows with line items", async () => {
    const gid = "gid://shopify/Order/2002";
    await t.db.insert(orders).values({ organizationId: t.orgId, source: "SHOPIFY", externalOrderId: gid, revenue: 99, status: "PAID" });
    const r = await upsertShopifyOrder(t.db, t.orgId, normalizeRestOrder(restOrder({ id: 2002, admin_graphql_api_id: gid })));
    expect(r).toMatchObject({ created: 3, removed: 1 });
    const rows = await rowsFor(t.orgId, gid);
    expect(rows.map((x) => x.externalLineId)).not.toContain("");
    expect(rows.reduce((s, x) => s + x.revenue, 0)).toBeCloseTo(58.98);
  });
});

describe("webhook routing", () => {
  it("routes by the sending store's domain", async () => {
    await handleShopifyWebhook(t.db, "orders/create", SHOP_B, restOrder({ id: 4004, admin_graphql_api_id: "gid://shopify/Order/4004" }));
    expect(await rowsFor(orgB, "gid://shopify/Order/4004")).toHaveLength(3);
    expect(await rowsFor(t.orgId, "gid://shopify/Order/4004")).toHaveLength(0);
  });
  it("ignores stores nobody connected", async () => {
    expect(await handleShopifyWebhook(t.db, "orders/create", "nobody.myshopify.com", restOrder())).toEqual({ ignored: "unknown shop" });
  });
  it("sends the single-token store to the default organisation, and only that store may use the store secret", async () => {
    await handleShopifyWebhook(t.db, "orders/create", SOLO, restOrder({ id: 5005, admin_graphql_api_id: "gid://shopify/Order/5005" }), "store");
    expect(await rowsFor(t.orgId, "gid://shopify/Order/5005")).toHaveLength(3);
    expect(await handleShopifyWebhook(t.db, "orders/create", SHOP_A, restOrder(), "store")).toEqual({ ignored: "unknown shop" });
  });
});

describe("webhook endpoint", () => {
  const deliver = (body: unknown, opts: { secret: string; shop: string; id: string; topic?: string }) => {
    const raw = JSON.stringify(body);
    return shopifyWebhook(
      new NextRequest("http://localhost/api/webhooks/shopify", {
        method: "POST",
        body: raw,
        headers: {
          "content-type": "application/json",
          "x-shopify-hmac-sha256": crypto.createHmac("sha256", opts.secret).update(raw).digest("base64"),
          "x-shopify-topic": opts.topic ?? "orders/create",
          "x-shopify-shop-domain": opts.shop,
          "x-shopify-webhook-id": opts.id,
        },
      }),
    );
  };
  const order = (id: number) => restOrder({ id, admin_graphql_api_id: `gid://shopify/Order/${id}` });

  it("accepts app-signed webhooks and de-duplicates by webhook id", async () => {
    expect((await deliver(order(6001), { secret: "app-secret", shop: SHOP_A, id: "wh-1" })).status).toBe(200);
    expect(await (await deliver(order(6001), { secret: "app-secret", shop: SHOP_A, id: "wh-1" })).json()).toEqual({ duplicate: true });
    expect(await rowsFor(t.orgId, "gid://shopify/Order/6001")).toHaveLength(3);
  });
  it("accepts the store secret only for the single-token store", async () => {
    expect((await deliver(order(6002), { secret: "store-secret", shop: SHOP_A, id: "wh-2" })).status).toBe(401);
    expect((await deliver(order(6002), { secret: "store-secret", shop: SOLO, id: "wh-3" })).status).toBe(200);
  });
  it("rejects bad signatures", async () => {
    expect((await deliver(order(6003), { secret: "wrong", shop: SHOP_A, id: "wh-4" })).status).toBe(401);
  });
  it("lets Shopify retry a delivery that failed to process", async () => {
    expect((await deliver({ not: "an order" }, { secret: "app-secret", shop: SHOP_A, id: "wh-5" })).status).toBe(500);
    expect((await deliver({ not: "an order" }, { secret: "app-secret", shop: SHOP_A, id: "wh-5" })).status).toBe(500); // retried, not "duplicate"
  });
});

describe("webhook registration", () => {
  it("makes no Shopify writes in DEMO_MODE", async () => {
    const calls = fakeShopify();
    expect((await ensureShopifyWebhooks(t.db, t.orgId)).skipped).toMatch(/DEMO_MODE/);
    expect(calls).toHaveLength(0);
  });
  it("requires an https APP_URL", async () => {
    liveMode("http://localhost:3000");
    const calls = fakeShopify();
    expect((await ensureShopifyWebhooks(t.db, t.orgId)).skipped).toMatch(/https/);
    expect(calls).toHaveLength(0);
  });
  it("creates only the missing subscriptions and records the result", async () => {
    liveMode();
    const uri = "https://forge.example/api/webhooks/shopify";
    const calls = fakeShopify({ existingHooks: [{ topic: "ORDERS_CREATE", uri }, { topic: "ORDERS_UPDATED", uri: "https://other.example/hook" }] });
    const r = await ensureShopifyWebhooks(t.db, t.orgId);
    expect(r.existing).toEqual(["ORDERS_CREATE"]);
    expect(r.created).toEqual(["ORDERS_UPDATED", "ORDERS_CANCELLED", "REFUNDS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "APP_UNINSTALLED"]);
    expect(r.errors).toEqual([]);
    const creates = calls.filter((c) => c.query.includes("ForgeWebhookCreate"));
    expect(creates.every((c) => (c.variables.webhookSubscription as { uri: string }).uri === uri)).toBe(true);
    const [row] = await t.db.select().from(integrations).where(and(eq(integrations.organizationId, t.orgId), eq(integrations.kind, "SHOPIFY")));
    expect(row.config.webhooks).toMatchObject({ uri, created: r.created });
  });
});

describe("refunds and sync", () => {
  it("re-reads the whole order when a refund webhook arrives", async () => {
    liveMode();
    fakeShopify({ orders: [gqlOrder()] });
    await handleShopifyWebhook(t.db, "refunds/create", SHOP_A, { id: 9, order_id: 3003 });
    const [row] = await rowsFor(t.orgId, "gid://shopify/Order/3003");
    expect(row).toMatchObject({ status: "PARTIALLY_REFUNDED", quantity: 2, revenue: 25.98, refundedAmount: 12.99, utmSource: "pinterest" });
  });
  it("defers refund webhooks to orders/updated in DEMO_MODE", async () => {
    const calls = fakeShopify({ orders: [gqlOrder()] });
    expect(await handleShopifyWebhook(t.db, "refunds/create", SHOP_A, { id: 10, order_id: 3003 })).toMatchObject({ reconcileVia: "orders/updated" });
    expect(calls).toHaveLength(0);
  });
  it("syncs recently updated orders by re-reading each one", async () => {
    liveMode();
    fakeShopify({ orders: [gqlOrder({ id: "gid://shopify/Order/7007", displayFinancialStatus: "PAID", refunds: [], lineItems: { pageInfo: { hasNextPage: false }, nodes: [{ id: "gid://shopify/LineItem/71", quantity: 1, currentQuantity: 1, product: { id: PB }, originalTotalSet: money(30), discountAllocations: [] }] } })] });
    expect(await syncShopifyOrders(t.ctx)).toMatchObject({ orders: 1, created: 1, truncated: false });
    expect((await rowsFor(t.orgId, "gid://shopify/Order/7007"))[0]).toMatchObject({ status: "PAID", revenue: 30, cost: 10 });
  });
});
