// Shopify Admin API integration (server-side only). OAuth (public/custom app) or a single-store
// custom-app token from env. All secrets stay on the server; tokens are encrypted at rest.

import { and, eq, gt } from "drizzle-orm";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { integrations, oauthStates, orders, products } from "../db/schema";
import { env, isDemoMode } from "../env";
import { assertOutboundAllowed } from "../demo";
import { audit } from "../audit";
import { IntegrationNotConfiguredError, NotFoundError, ValidationError } from "../errors";
import { decryptJson, encryptJson, hmac, randomToken, safeEqual } from "../security/crypto";
import type { DiscoveredProduct } from "../discovery/types";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const isValidShopDomain = (shop: string) => SHOP_RE.test(shop);

export interface ShopifyConnection {
  shop: string;
  token: string;
  source: "oauth" | "env";
}

export const SHOPIFY_REQUIREMENTS = [
  "Either: SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (app from the Shopify Dev Dashboard) and connect via OAuth",
  "Or: SHOPIFY_SHOP_DOMAIN + SHOPIFY_ACCESS_TOKEN (custom app Admin API token)",
  `Scopes: ${"read_products, write_products, read_orders, read_inventory"}`,
];

export async function getShopifyConnection(ctx: Pick<ServiceContext, "db" | "orgId">): Promise<ShopifyConnection | null> {
  const [row] = await ctx.db.select().from(integrations).where(and(eq(integrations.organizationId, ctx.orgId), eq(integrations.kind, "SHOPIFY"))).limit(1);
  if (row?.status === "CONNECTED") {
    const creds = decryptJson<{ accessToken: string }>(row.credentialsEncrypted);
    const shop = String(row.config?.shop ?? "");
    if (creds?.accessToken && isValidShopDomain(shop)) return { shop, token: creds.accessToken, source: "oauth" };
  }
  const e = env();
  if (e.SHOPIFY_SHOP_DOMAIN && e.SHOPIFY_ACCESS_TOKEN && isValidShopDomain(e.SHOPIFY_SHOP_DOMAIN)) return { shop: e.SHOPIFY_SHOP_DOMAIN, token: e.SHOPIFY_ACCESS_TOKEN, source: "env" };
  return null;
}

export async function shopifyStatus(ctx: Pick<ServiceContext, "db" | "orgId">) {
  const conn = await getShopifyConnection(ctx);
  const [row] = await ctx.db.select().from(integrations).where(and(eq(integrations.organizationId, ctx.orgId), eq(integrations.kind, "SHOPIFY"))).limit(1);
  return {
    oauthAppConfigured: !!(env().SHOPIFY_CLIENT_ID && env().SHOPIFY_CLIENT_SECRET),
    connected: !!conn,
    shop: conn?.shop ?? null,
    source: conn?.source ?? null,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastError: row?.lastError ?? null,
    apiVersion: env().SHOPIFY_API_VERSION,
    requirements: SHOPIFY_REQUIREMENTS,
    demoMode: isDemoMode(),
  };
}

// ── OAuth ────────────────────────────────────────────────────────────────────
export async function beginShopifyOAuth(ctx: ServiceContext, shopInput: string): Promise<string> {
  assertCan(ctx, "integrations:manage");
  const shop = shopInput.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!isValidShopDomain(shop)) throw new ValidationError("Enter your store's myshopify.com domain, e.g. my-store.myshopify.com");
  const e = env();
  if (!e.SHOPIFY_CLIENT_ID || !e.SHOPIFY_CLIENT_SECRET) throw new IntegrationNotConfiguredError("Shopify OAuth", ["SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]);
  const state = randomToken(24);
  await ctx.db.insert(oauthStates).values({ state, kind: "SHOPIFY", organizationId: ctx.orgId, userId: ctx.userId, data: { shop }, expiresAt: new Date(Date.now() + 10 * 60_000) });
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", e.SHOPIFY_CLIENT_ID);
  url.searchParams.set("scope", e.SHOPIFY_SCOPES);
  url.searchParams.set("redirect_uri", new URL("/api/integrations/shopify/callback", e.APP_URL).toString());
  url.searchParams.set("state", state);
  return url.toString();
}

/** Verifies the `hmac` query parameter Shopify signs OAuth redirects with. */
export function verifyShopifyQueryHmac(params: URLSearchParams, secret: string): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return safeEqual(hmac(secret, message, "hex"), provided);
}

export async function completeShopifyOAuth(db: Database, params: URLSearchParams): Promise<{ orgId: string; shop: string }> {
  const e = env();
  if (!e.SHOPIFY_CLIENT_SECRET) throw new IntegrationNotConfiguredError("Shopify OAuth", ["SHOPIFY_CLIENT_SECRET"]);
  if (!verifyShopifyQueryHmac(params, e.SHOPIFY_CLIENT_SECRET)) throw new ValidationError("Invalid Shopify signature");
  const shop = params.get("shop") ?? "";
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!isValidShopDomain(shop) || !state || !code) throw new ValidationError("Malformed OAuth callback");
  const [st] = await db.select().from(oauthStates).where(and(eq(oauthStates.state, state), gt(oauthStates.expiresAt, new Date()))).limit(1);
  if (!st || st.data?.shop !== shop) throw new ValidationError("OAuth state mismatch or expired — start the connection again");
  await db.delete(oauthStates).where(eq(oauthStates.state, state));
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: e.SHOPIFY_CLIENT_ID, client_secret: e.SHOPIFY_CLIENT_SECRET, code }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; scope?: string; refresh_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) throw new Error(`Shopify token exchange failed (${res.status})`);
  const values = {
    status: "CONNECTED" as const,
    displayName: shop,
    config: { shop, scope: json.scope ?? "" },
    credentialsEncrypted: encryptJson({ accessToken: json.access_token, refreshToken: json.refresh_token ?? "", expiresIn: String(json.expires_in ?? "") }),
    connectedAt: new Date(),
    lastError: null,
  };
  await db
    .insert(integrations)
    .values({ organizationId: st.organizationId, kind: "SHOPIFY", ...values })
    .onConflictDoUpdate({ target: [integrations.organizationId, integrations.kind], set: values });
  return { orgId: st.organizationId, shop };
}

export async function disconnectShopify(ctx: ServiceContext) {
  assertCan(ctx, "integrations:manage");
  await ctx.db.update(integrations).set({ status: "NOT_CONFIGURED", credentialsEncrypted: null }).where(and(eq(integrations.organizationId, ctx.orgId), eq(integrations.kind, "SHOPIFY")));
  await audit(ctx, "shopify.disconnect", { type: "integration", id: "SHOPIFY" });
}

/** Webhooks are signed with the app secret: base64 HMAC-SHA256 of the raw body. */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  return safeEqual(hmac(secret, rawBody, "base64"), hmacHeader);
}

// ── Admin GraphQL client ─────────────────────────────────────────────────────
export async function shopifyGraphql<T>(conn: ShopifyConnection, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://${conn.shop}/admin/api/${env().SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string }> | string };
  if (!res.ok || json.errors) {
    const msg = typeof json.errors === "string" ? json.errors : json.errors?.map((e) => e.message).join("; ");
    throw new Error(`Shopify GraphQL error (${res.status}): ${msg ?? "request failed"}`);
  }
  return json.data as T;
}

const PRODUCT_SET = `
mutation ForgeProductSet($input: ProductSetInput!, $synchronous: Boolean!) {
  productSet(synchronous: $synchronous, input: $input) {
    product { id handle status }
    userErrors { field message }
  }
}`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Creates/updates the product in Shopify as a DRAFT (the operator reviews before activating). */
export async function publishProductToShopify(ctx: ServiceContext, productId: string) {
  assertCan(ctx, "integrations:manage");
  assertOutboundAllowed("shopify.productSet");
  const conn = await getShopifyConnection(ctx);
  if (!conn) throw new IntegrationNotConfiguredError("Shopify", SHOPIFY_REQUIREMENTS);
  const [p] = await ctx.db.select().from(products).where(and(eq(products.id, productId), eq(products.organizationId, ctx.orgId))).limit(1);
  if (!p) throw new NotFoundError("Product");
  if (!p.sellingPrice) throw new ValidationError("Set a selling price before publishing to Shopify");
  const input: Record<string, unknown> = {
    title: p.title,
    descriptionHtml: `<p>${escapeHtml(p.description ?? "")}</p>${p.highlights.length ? `<ul>${p.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>` : ""}`,
    vendor: p.brand ?? "FORGE",
    status: "DRAFT",
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [{ optionValues: [{ optionName: "Title", name: "Default Title" }], price: p.sellingPrice.toFixed(2) }],
    metafields: [
      { namespace: "forge", key: "score", type: "number_decimal", value: String(p.overallScore ?? 0) },
      { namespace: "forge", key: "product_id", type: "single_line_text_field", value: p.id },
    ],
  };
  if (p.shopifyProductId) input.id = p.shopifyProductId;
  const data = await shopifyGraphql<{ productSet: { product: { id: string; handle: string } | null; userErrors: Array<{ message: string }> } }>(conn, PRODUCT_SET, { input, synchronous: true });
  if (data.productSet.userErrors.length) throw new ValidationError(`Shopify rejected the product: ${data.productSet.userErrors.map((e) => e.message).join("; ")}`);
  const gid = data.productSet.product?.id;
  if (gid) await ctx.db.update(products).set({ shopifyProductId: gid, businessModels: Array.from(new Set([...p.businessModels, "SHOPIFY"])) }).where(eq(products.id, p.id));
  await audit(ctx, "shopify.product_publish", { type: "product", id: p.id }, { gid });
  return { gid, handle: data.productSet.product?.handle };
}

const ORDERS_QUERY = `
query ForgeOrders($cursor: String, $query: String) {
  orders(first: 50, after: $cursor, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customerJourneySummary { lastVisit { utmParameters { source campaign content } } }
      lineItems(first: 20) { nodes { quantity product { id } } }
    }
  }
}`;

type OrderNode = {
  id: string;
  createdAt: string;
  displayFinancialStatus: string | null;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customerJourneySummary: { lastVisit: { utmParameters: { source: string | null; campaign: string | null; content: string | null } | null } | null } | null;
  lineItems: { nodes: Array<{ quantity: number; product: { id: string } | null }> };
};

export async function syncShopifyOrders(ctx: ServiceContext, sinceDays = 7) {
  if (isDemoMode()) return { skipped: "DEMO_MODE — Shopify sync disabled" };
  const conn = await getShopifyConnection(ctx);
  if (!conn) return { skipped: "Shopify not connected" };
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const byGid = new Map((await ctx.db.select({ id: products.id, gid: products.shopifyProductId, cost: products.cost, ship: products.shippingCost }).from(products).where(eq(products.organizationId, ctx.orgId))).filter((r) => r.gid).map((r) => [r.gid!, r]));
  let cursor: string | null = null;
  let imported = 0;
  for (let page = 0; page < 20; page++) {
    const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] } } = await shopifyGraphql(conn, ORDERS_QUERY, { cursor, query: `created_at:>=${since}` });
    for (const o of data.orders.nodes) {
      const line = o.lineItems.nodes.find((l) => l.product && byGid.has(l.product.id));
      const mapped = line?.product ? byGid.get(line.product.id) : undefined;
      const utm = o.customerJourneySummary?.lastVisit?.utmParameters;
      const qty = line?.quantity ?? 1;
      const res = await ctx.db
        .insert(orders)
        .values({
          organizationId: ctx.orgId,
          productId: mapped?.id ?? null,
          source: "SHOPIFY",
          externalOrderId: o.id,
          status: o.displayFinancialStatus === "REFUNDED" ? "REFUNDED" : "PAID",
          quantity: qty,
          revenue: Number(o.currentTotalPriceSet.shopMoney.amount),
          cost: (mapped?.cost ?? 0) * qty,
          shippingCost: (mapped?.ship ?? 0) * qty,
          currency: o.currentTotalPriceSet.shopMoney.currencyCode,
          utmSource: utm?.source ?? null,
          utmCampaign: utm?.campaign ?? null,
          utmContent: utm?.content ?? null,
          occurredAt: new Date(o.createdAt),
        })
        .onConflictDoNothing()
        .returning({ id: orders.id });
      imported += res.length;
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  await ctx.db.update(integrations).set({ lastSyncAt: new Date(), lastError: null }).where(and(eq(integrations.organizationId, ctx.orgId), eq(integrations.kind, "SHOPIFY")));
  return { imported };
}

const CATALOG_QUERY = `
query ForgeCatalog($first: Int!, $query: String) {
  products(first: $first, query: $query) {
    nodes { id title descriptionHtml vendor productType totalInventory featuredImage { url } priceRangeV2 { minVariantPrice { amount currencyCode } } }
  }
}`;

/** Used by the Shopify-supplier discovery adapter (env connection; read-only). */
export async function fetchShopifyCatalog(limit: number, keywords: string[]): Promise<DiscoveredProduct[]> {
  const e = env();
  if (!e.SHOPIFY_SHOP_DOMAIN || !e.SHOPIFY_ACCESS_TOKEN) throw new IntegrationNotConfiguredError("Shopify supplier catalog", SHOPIFY_REQUIREMENTS);
  const conn: ShopifyConnection = { shop: e.SHOPIFY_SHOP_DOMAIN, token: e.SHOPIFY_ACCESS_TOKEN, source: "env" };
  const data = await shopifyGraphql<{ products: { nodes: Array<{ id: string; title: string; descriptionHtml: string; vendor: string; productType: string; totalInventory: number | null; featuredImage: { url: string } | null; priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } } }> } }>(conn, CATALOG_QUERY, {
    first: Math.min(limit, 100),
    query: keywords.length ? keywords.map((k) => `title:*${k.replace(/[^a-zA-Z0-9 ]/g, "")}*`).join(" OR ") : null,
  });
  return data.products.nodes.map((n) => ({
    sourceProductId: n.id,
    title: n.title,
    description: n.descriptionHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000),
    brand: n.vendor,
    category: n.productType || undefined,
    imageUrl: n.featuredImage?.url,
    currency: n.priceRangeV2.minVariantPrice.currencyCode,
    sellingPrice: Number(n.priceRangeV2.minVariantPrice.amount),
    businessModel: "SHOPIFY",
    provenance: "REAL",
    sourceLabel: `Shopify (${conn.shop})`,
  }));
}

/** Handles verified webhook topics. Compliance topics are acknowledged and audited. */
export async function handleShopifyWebhook(db: Database, topic: string, shop: string, payload: Record<string, unknown>) {
  const [integration] = await db.select().from(integrations).where(eq(integrations.kind, "SHOPIFY"));
  const orgId = integration && integration.config?.shop === shop ? integration.organizationId : null;
  if (!orgId) return { ignored: "unknown shop" };
  if (topic === "app/uninstalled") {
    await db.update(integrations).set({ status: "NOT_CONFIGURED", credentialsEncrypted: null, lastError: "App uninstalled from Shopify" }).where(eq(integrations.id, integration.id));
    return { disconnected: true };
  }
  if (topic === "orders/create" || topic === "orders/paid") {
    const lines = (payload.line_items as Array<{ product_id?: number; quantity?: number }>) ?? [];
    const gids = lines.map((l) => `gid://shopify/Product/${l.product_id}`);
    const mapped = (await db.select({ id: products.id, gid: products.shopifyProductId }).from(products).where(eq(products.organizationId, orgId))).find((p) => p.gid && gids.includes(p.gid));
    await db
      .insert(orders)
      .values({ organizationId: orgId, productId: mapped?.id ?? null, source: "SHOPIFY", externalOrderId: `gid://shopify/Order/${payload.id}`, status: "PAID", revenue: Number(payload.current_total_price ?? payload.total_price ?? 0), currency: String(payload.currency ?? "USD"), occurredAt: new Date(String(payload.created_at ?? new Date().toISOString())) })
      .onConflictDoNothing();
    return { order: true };
  }
  return { acknowledged: topic };
}
