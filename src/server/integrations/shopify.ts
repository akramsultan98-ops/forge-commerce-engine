// Shopify Admin API integration (server-side only). OAuth (public/custom app) or a single-store
// custom-app token from env. All secrets stay on the server; tokens are encrypted at rest.

import { and, eq, gt, sql } from "drizzle-orm";
import { assertCan, type ServiceContext } from "../context";
import type { Database } from "../db/client";
import { integrations, oauthStates, products } from "../db/schema";
import { env, isDemoMode } from "../env";
import { assertOutboundAllowed } from "../demo";
import { audit } from "../audit";
import { IntegrationNotConfiguredError, NotFoundError, ValidationError } from "../errors";
import { decryptJson, encryptJson, hmac, randomToken, safeEqual } from "../security/crypto";
import type { DiscoveredProduct } from "../discovery/types";
import { normalizeGraphqlOrder, normalizeRestOrder, upsertShopifyOrder, type GraphqlOrderNode } from "./shopify-orders";

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

/** Topics FORGE subscribes to after a store connects. Compliance topics are declared in the app config instead. */
export const SHOPIFY_WEBHOOK_TOPICS = ["ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_CANCELLED", "REFUNDS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "APP_UNINSTALLED"] as const;
export const SHOPIFY_COMPLIANCE_TOPICS = ["customers/data_request", "customers/redact", "shop/redact"] as const;

export interface WebhookRegistration {
  at: string;
  uri: string;
  created: string[];
  existing: string[];
  errors: string[];
  skipped?: string;
}

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
  const e = env();
  return {
    oauthAppConfigured: !!(e.SHOPIFY_CLIENT_ID && e.SHOPIFY_CLIENT_SECRET),
    webhookSecretConfigured: !!(e.SHOPIFY_CLIENT_SECRET || e.SHOPIFY_WEBHOOK_SECRET),
    connected: !!conn,
    shop: conn?.shop ?? null,
    source: conn?.source ?? null,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastError: row?.lastError ?? null,
    webhooks: (row?.config?.webhooks as WebhookRegistration | undefined) ?? null,
    apiVersion: e.SHOPIFY_API_VERSION,
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

// ── Webhook verification & routing ──────────────────────────────────────────
/** Webhooks are signed with the app secret: base64 HMAC-SHA256 of the raw body. */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader || !secret) return false;
  return safeEqual(hmac(secret, rawBody, "base64"), hmacHeader);
}

/**
 * Which configured secret signed a webhook: "app" = the app's client secret (OAuth apps and custom
 * apps' API secret), "store" = a store-level webhook secret (single-token setups). null = neither.
 */
export type WebhookSecretKind = "app" | "store";
export function matchWebhookSecret(rawBody: string, hmacHeader: string | null): WebhookSecretKind | null {
  const e = env();
  if (e.SHOPIFY_CLIENT_SECRET && verifyShopifyWebhook(rawBody, hmacHeader, e.SHOPIFY_CLIENT_SECRET)) return "app";
  if (e.SHOPIFY_WEBHOOK_SECRET && verifyShopifyWebhook(rawBody, hmacHeader, e.SHOPIFY_WEBHOOK_SECRET)) return "store";
  return null;
}

/**
 * Organisations a webhook from `shop` belongs to. OAuth connections match their stored shop domain
 * exactly; the single-token store (SHOPIFY_SHOP_DOMAIN) belongs to the default organisation. A
 * store-level secret only ever authenticates that one store.
 */
export async function resolveShopifyOrgs(db: Database, shop: string, via: WebhookSecretKind): Promise<Array<{ orgId: string; integrationId: string | null }>> {
  const domain = shop.toLowerCase();
  if (via === "app") {
    const rows = await db
      .select({ id: integrations.id, orgId: integrations.organizationId })
      .from(integrations)
      .where(and(eq(integrations.kind, "SHOPIFY"), eq(integrations.status, "CONNECTED"), sql`lower(${integrations.config}->>'shop') = ${domain}`));
    if (rows.length) return rows.map((r) => ({ orgId: r.orgId, integrationId: r.id }));
  }
  const envShop = env().SHOPIFY_SHOP_DOMAIN.toLowerCase();
  if (envShop && envShop === domain) {
    const { ensureDefaultOrganization } = await import("../services/org");
    return [{ orgId: (await ensureDefaultOrganization(db)).id, integrationId: null }];
  }
  return [];
}

const ORDER_TOPICS = new Set(["orders/create", "orders/updated", "orders/paid", "orders/cancelled"]);

/** Handles a verified webhook for every organisation connected to `shop`. */
export async function handleShopifyWebhook(db: Database, topic: string, shop: string, payload: Record<string, unknown>, via: WebhookSecretKind = "app") {
  const targets = await resolveShopifyOrgs(db, shop, via);
  if (!targets.length) return { ignored: "unknown shop" };
  const results: unknown[] = [];
  for (const target of targets) results.push(await handleForOrg(db, target, topic, payload));
  return results.length === 1 ? (results[0] as Record<string, unknown>) : { orgs: results };
}

async function handleForOrg(db: Database, target: { orgId: string; integrationId: string | null }, topic: string, payload: Record<string, unknown>) {
  const { orgId } = target;
  if (topic === "app/uninstalled") {
    if (!target.integrationId) return { acknowledged: topic };
    await db.update(integrations).set({ status: "NOT_CONFIGURED", credentialsEncrypted: null, lastError: "App uninstalled from Shopify" }).where(eq(integrations.id, target.integrationId));
    return { disconnected: true };
  }
  if (topic === "products/update" || topic === "products/delete") {
    const gid = `gid://shopify/Product/${payload.id}`;
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.organizationId, orgId), eq(products.shopifyProductId, gid))).limit(1);
    if (!p) return { ignored: "unmapped product" };
    const variants = (payload.variants as Array<{ inventory_quantity?: number; inventory_management?: string | null }>) ?? [];
    const tracked = variants.filter((v) => v.inventory_management);
    const unavailable = topic === "products/delete" || payload.status === "archived" || (tracked.length > 0 && tracked.every((v) => (v.inventory_quantity ?? 0) <= 0));
    if (unavailable) {
      const { systemContext } = await import("../context");
      const { markProductUnavailable } = await import("../services/products");
      await markProductUnavailable(systemContext(orgId, db), p.id, topic === "products/delete" ? "The product was deleted in Shopify" : "Shopify reports the product as out of stock or archived");
    } else {
      await db.update(products).set({ available: true, lastCheckedAt: new Date() }).where(eq(products.id, p.id));
    }
    return { available: !unavailable };
  }
  if (ORDER_TOPICS.has(topic)) {
    return { order: await upsertShopifyOrder(db, orgId, normalizeRestOrder(payload)) };
  }
  if (topic === "refunds/create") {
    // The refund payload is partial — re-read the whole order so every line reflects Shopify's state.
    // Without API access (or in DEMO_MODE) the orders/updated webhook Shopify also sends reconciles it.
    const orderGid = payload.order_id ? `gid://shopify/Order/${payload.order_id}` : null;
    const conn = orderGid && !isDemoMode() ? await getShopifyConnection({ db, orgId }) : null;
    if (!orderGid || !conn) return { acknowledged: topic, reconcileVia: "orders/updated" };
    const node = await fetchShopifyOrder(conn, orderGid);
    if (!node) return { ignored: "order not found" };
    return { order: await upsertShopifyOrder(db, orgId, normalizeGraphqlOrder(node)) };
  }
  return { acknowledged: topic };
}

// ── Admin GraphQL client ─────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function shopifyGraphql<T>(conn: ShopifyConnection, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${conn.shop}/admin/api/${env().SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": conn.token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> | string };
    const throttled = res.status === 429 || (Array.isArray(json.errors) && json.errors.some((e) => e.extensions?.code === "THROTTLED"));
    if (throttled && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (!res.ok || json.errors) {
      const msg = typeof json.errors === "string" ? json.errors : json.errors?.map((e) => e.message).join("; ");
      throw new Error(`Shopify GraphQL error (${res.status}): ${msg ?? "request failed"}`);
    }
    return json.data as T;
  }
}

// ── Webhook registration ─────────────────────────────────────────────────────
const LIST_WEBHOOKS = `query ForgeWebhooks { webhookSubscriptions(first: 100) { nodes { id topic uri } } }`;
const CREATE_WEBHOOK = `
mutation ForgeWebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}`;

/** Creates any missing FORGE webhook subscriptions for `uri` (idempotent: existing ones are kept). */
export async function registerShopifyWebhooks(conn: ShopifyConnection, uri: string): Promise<Pick<WebhookRegistration, "created" | "existing" | "errors">> {
  assertOutboundAllowed("shopify.webhookSubscriptionCreate");
  const list = await shopifyGraphql<{ webhookSubscriptions: { nodes: Array<{ topic: string; uri: string | null }> } }>(conn, LIST_WEBHOOKS);
  const have = new Set(list.webhookSubscriptions.nodes.filter((n) => n.uri === uri).map((n) => n.topic));
  const out = { created: [] as string[], existing: [] as string[], errors: [] as string[] };
  for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
    if (have.has(topic)) {
      out.existing.push(topic);
      continue;
    }
    const r = await shopifyGraphql<{ webhookSubscriptionCreate: { webhookSubscription: { id: string } | null; userErrors: Array<{ message: string }> } }>(conn, CREATE_WEBHOOK, { topic, webhookSubscription: { uri } });
    const errs = r.webhookSubscriptionCreate.userErrors;
    if (errs.length || !r.webhookSubscriptionCreate.webhookSubscription) out.errors.push(`${topic}: ${errs.map((e) => e.message).join("; ") || "not created"}`);
    else out.created.push(topic);
  }
  return out;
}

/** Registers webhooks for an organisation's connected store and records the outcome. Never throws. */
export async function ensureShopifyWebhooks(db: Database, orgId: string): Promise<WebhookRegistration> {
  const uri = new URL("/api/webhooks/shopify", env().APP_URL).toString();
  const base: WebhookRegistration = { at: new Date().toISOString(), uri, created: [], existing: [], errors: [] };
  let result: WebhookRegistration;
  try {
    const conn = await getShopifyConnection({ db, orgId });
    if (!conn) result = { ...base, skipped: "Shopify is not connected" };
    else if (isDemoMode()) result = { ...base, skipped: "DEMO_MODE is on — FORGE makes no Shopify writes" };
    else if (!uri.startsWith("https://")) result = { ...base, skipped: "APP_URL must be an https:// URL — Shopify only delivers webhooks over HTTPS" };
    else result = { ...base, ...(await registerShopifyWebhooks(conn, uri)) };
  } catch (err) {
    result = { ...base, errors: [err instanceof Error ? err.message.slice(0, 300) : "registration failed"] };
  }
  const [row] = await db.select({ id: integrations.id, config: integrations.config }).from(integrations).where(and(eq(integrations.organizationId, orgId), eq(integrations.kind, "SHOPIFY"))).limit(1);
  if (row) await db.update(integrations).set({ config: { ...row.config, webhooks: result } }).where(eq(integrations.id, row.id));
  return result;
}

// ── Products ─────────────────────────────────────────────────────────────────
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

// ── Orders ───────────────────────────────────────────────────────────────────
// Shipping address is protected customer data, so it is not requested; country comes from webhooks.
const ORDER_FIELDS = `
  id createdAt updatedAt cancelledAt displayFinancialStatus currencyCode
  customerJourneySummary { lastVisit { utmParameters { source campaign content } } }
  lineItems(first: 50) {
    pageInfo { hasNextPage }
    nodes {
      id quantity currentQuantity product { id }
      originalTotalSet { shopMoney { amount } }
      discountAllocations { allocatedAmountSet { shopMoney { amount } } }
    }
  }
  refunds(first: 5) { refundLineItems(first: 30) { nodes { lineItem { id } quantity subtotalSet { shopMoney { amount } } } } }`;
const ORDER_QUERY = `query ForgeOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
// Listing ids first keeps each request well under Shopify's per-query cost limit.
const ORDER_IDS_QUERY = `
query ForgeOrderIds($cursor: String, $query: String) {
  orders(first: 50, after: $cursor, query: $query, sortKey: UPDATED_AT) { pageInfo { hasNextPage endCursor } nodes { id } }
}`;

export async function fetchShopifyOrder(conn: ShopifyConnection, orderGid: string): Promise<GraphqlOrderNode | null> {
  const data = await shopifyGraphql<{ order: GraphqlOrderNode | null }>(conn, ORDER_QUERY, { id: orderGid });
  return data.order;
}

/** Re-reads every order updated in the window (new orders, payments, refunds, cancellations) and upserts it. */
export async function syncShopifyOrders(ctx: ServiceContext, sinceDays = 7) {
  if (isDemoMode()) return { skipped: "DEMO_MODE — Shopify sync disabled" };
  const conn = await getShopifyConnection(ctx);
  if (!conn) return { skipped: "Shopify not connected" };
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const summary = { orders: 0, created: 0, updated: 0, removed: 0, stale: 0, truncated: false };
  const integration = and(eq(integrations.organizationId, ctx.orgId), eq(integrations.kind, "SHOPIFY"));
  try {
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= 20) {
        summary.truncated = true;
        break;
      }
      const data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string }> } } = await shopifyGraphql(conn, ORDER_IDS_QUERY, { cursor, query: `updated_at:>='${since}'` });
      for (const { id } of data.orders.nodes) {
        const node = await fetchShopifyOrder(conn, id);
        if (!node) continue;
        const r = await upsertShopifyOrder(ctx.db, ctx.orgId, normalizeGraphqlOrder(node));
        summary.orders++;
        summary.created += r.created;
        summary.updated += r.updated;
        summary.removed += r.removed;
        if (r.stale) summary.stale++;
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
  } catch (err) {
    await ctx.db.update(integrations).set({ lastError: err instanceof Error ? err.message.slice(0, 500) : "sync failed" }).where(integration);
    throw err;
  }
  await ctx.db.update(integrations).set({ lastSyncAt: new Date(), lastError: null }).where(integration);
  return summary;
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
