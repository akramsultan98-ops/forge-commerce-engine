// Product discovery adapters. Official APIs only. Adapters that need an approved partner app or
// paid access ship as "interface" (contract + setup state + documentation) — never faked.

import { env, isDemoMode } from "../env";
import { mapProductCsv } from "@/domain/csv";
import { trendFromSeries } from "@/domain/trends";
import { safeFetch } from "../security/safe-fetch";
import { IntegrationNotConfiguredError } from "../errors";
import { DEMO_DISCOVERY_POOL } from "./demo-pool";
import type { Credentials, DiscoveredProduct, DiscoveryQuery, SourceAdapter, TrendSignal } from "./types";

const firstNumber = (v: unknown): number | undefined => {
  if (typeof v === "number") return v;
  const m = String(v ?? "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};

// ── Manual CSV / feed import ────────────────────────────────────────────────
export const manualImportAdapter: SourceAdapter = {
  key: "MANUAL_IMPORT",
  label: "Manual CSV import",
  kind: "manual",
  officialApi: true,
  docsUrl: "/admin/products/discover#import",
  requirements: [],
  implementation: "implemented",
  notes: "Upload a CSV with a header row. Recognised columns: title, price, cost, commission, url, affiliate_url, image, category, rating, reviews, shipping_days, countries, tags…",
  isConfigured: () => true,
};

// ── Affiliate network / merchant product feed (Awin, ShareASale, Impact catalog exports, any CSV feed URL) ──
export const affiliateFeedAdapter: SourceAdapter = {
  key: "AFFILIATE_NETWORK",
  label: "Affiliate product feed (CSV URL)",
  kind: "affiliate",
  officialApi: true,
  docsUrl: "https://wiki.awin.com/index.php/Product_Feeds_for_Publishers",
  requirements: ["feedUrl — the network's official product-feed download URL (includes your feed API key)", "Optional: default commission % and network name"],
  implementation: "implemented",
  notes: "Fetched through FORGE's SSRF-safe client; rows are mapped with the CSV importer. Commission comes from the feed or the configured default.",
  isConfigured: (_c, config) => typeof config.feedUrl === "string" && /^https:\/\//.test(config.feedUrl as string),
  async discover(query, _creds, config) {
    const res = await safeFetch(String(config.feedUrl), { timeoutMs: 30_000, maxBytes: 25_000_000 });
    if (res.status !== 200) throw new Error(`Feed returned HTTP ${res.status}`);
    const mapped = mapProductCsv(res.body.toString("utf8"), 20_000);
    const kw = query.keywords.map((k) => k.toLowerCase());
    const defaultCommission = typeof config.defaultCommission === "number" ? config.defaultCommission : undefined;
    return mapped.rows
      .filter((r) => !kw.length || kw.some((k) => r.title.toLowerCase().includes(k)))
      .filter((r) => query.maxPriceUsd === undefined || r.sellingPrice === undefined || r.sellingPrice <= query.maxPriceUsd)
      .slice(0, query.limit)
      .map((r) => ({
        ...r,
        sourceProductId: r.sourceProductId ?? r.productUrl ?? r.title,
        currency: r.currency ?? "USD",
        commissionPercentage: r.commissionPercentage ?? defaultCommission,
        businessModel: "AFFILIATE" as const,
        provenance: "REAL" as const,
        sourceLabel: String(config.networkName ?? "affiliate feed"),
        sourceUrl: r.productUrl,
      }));
  },
};

// ── CJdropshipping (official API v2) ─────────────────────────────────────────
const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";
let cjToken: { token: string; expires: number } | null = null;

async function cjAccessToken(apiKey: string): Promise<string> {
  if (cjToken && cjToken.expires > Date.now() + 60_000) return cjToken.token;
  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }), signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { result?: boolean; message?: string; data?: { accessToken?: string; accessTokenExpiryDate?: string } };
  if (!res.ok || !json.data?.accessToken) throw new Error(`CJ authentication failed: ${json.message ?? res.status}`);
  cjToken = { token: json.data.accessToken, expires: json.data.accessTokenExpiryDate ? Date.parse(json.data.accessTokenExpiryDate) : Date.now() + 3600_000 };
  return cjToken.token;
}

export const cjAdapter: SourceAdapter = {
  key: "CJ",
  label: "CJdropshipping",
  kind: "supplier",
  officialApi: true,
  docsUrl: "https://developers.cjdropshipping.com",
  requirements: ["CJ_API_KEY (CJ dashboard → Authorization → API)"],
  implementation: "implemented",
  notes: "Implemented against the documented API v2 (auth + product list). Verify field mapping with your account before relying on it.",
  isConfigured: (creds) => !!(creds.apiKey || env().CJ_API_KEY),
  async discover(query: DiscoveryQuery, creds: Credentials): Promise<DiscoveredProduct[]> {
    const apiKey = creds.apiKey || env().CJ_API_KEY;
    if (!apiKey) throw new IntegrationNotConfiguredError("CJdropshipping", this.requirements);
    const token = await cjAccessToken(apiKey);
    const out: DiscoveredProduct[] = [];
    for (const kw of query.keywords.length ? query.keywords : [""]) {
      const url = new URL(`${CJ_BASE}/product/list`);
      url.searchParams.set("pageNum", "1");
      url.searchParams.set("pageSize", String(Math.min(query.limit, 50)));
      if (kw) url.searchParams.set("productNameEn", kw);
      const res = await fetch(url, { headers: { "CJ-Access-Token": token }, signal: AbortSignal.timeout(20_000) });
      const json = (await res.json().catch(() => ({}))) as { data?: { list?: Array<Record<string, unknown>> }; message?: string };
      if (!res.ok) throw new Error(`CJ product list failed: ${json.message ?? res.status}`);
      for (const item of json.data?.list ?? []) {
        const cost = firstNumber(item.sellPrice);
        out.push({
          sourceProductId: String(item.pid ?? item.productSku ?? ""),
          title: String(item.productNameEn ?? "Untitled CJ product").slice(0, 200),
          category: typeof item.categoryName === "string" ? item.categoryName : undefined,
          imageUrl: typeof item.productImage === "string" ? item.productImage : undefined,
          supplierName: "CJdropshipping",
          supplierUrl: item.pid ? `https://cjdropshipping.com/product/-p-${item.pid}.html` : undefined,
          currency: "USD",
          cost,
          businessModel: "DROPSHIPPING",
          provenance: "REAL",
          sourceLabel: "CJdropshipping API",
        });
      }
      if (out.length >= query.limit) break;
    }
    return out.filter((p) => p.sourceProductId).slice(0, query.limit);
  },
};

// ── Wikimedia pageviews (official REST API, no key) — interest/trend signal ──
export const wikipediaTrendsAdapter: SourceAdapter = {
  key: "WIKIPEDIA_TRENDS",
  label: "Wikipedia interest (Wikimedia Pageviews API)",
  kind: "trend",
  officialApi: true,
  docsUrl: "https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/reference/page-views.html",
  requirements: ["A trend keyword per product = an English Wikipedia article title (e.g. “Cable management”)"],
  implementation: "implemented",
  notes: "Free, official and legal. A proxy for public interest — not sales. Recorded as REAL data with source attribution.",
  isConfigured: () => env().TRENDS_WIKIPEDIA_ENABLED,
  async signals(keyword: string): Promise<TrendSignal[]> {
    const article = encodeURIComponent(keyword.trim().replace(/\s+/g, "_"));
    const end = new Date(Date.now() - 86400_000);
    const start = new Date(end.getTime() - 90 * 86400_000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia.org/all-access/user/${article}/daily/${fmt(start)}/${fmt(end)}`;
    const res = await fetch(url, { headers: { "User-Agent": `FORGE/0.1 (${env().APP_URL}; product-trend-research)`, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`Wikimedia API returned ${res.status}`);
    const json = (await res.json()) as { items?: Array<{ views: number }> };
    const series = (json.items ?? []).map((i) => i.views);
    const t = trendFromSeries(series);
    if (!t) return [];
    const src = "Wikimedia Pageviews API";
    const page = `https://en.wikipedia.org/wiki/${article}`;
    return [
      { signal: "trend_index", value: t.score, provenance: "REAL", source: src, sourceUrl: page, meta: { keyword, method: "70% growth + 30% volume" } },
      { signal: "interest_growth_pct", value: t.growthPct, provenance: "REAL", source: src, sourceUrl: page, meta: { recentAvg: t.recentAvg, priorAvg: t.priorAvg } },
      { signal: "interest_daily_avg", value: t.recentAvg, provenance: "REAL", source: src, sourceUrl: page },
    ];
  },
};

// ── Demo discovery (DEMO_MODE only; every record labelled DEMO) ──────────────
export const demoAdapter: SourceAdapter = {
  key: "DEMO",
  label: "Demo discovery feed",
  kind: "demo",
  officialApi: false,
  docsUrl: "/docs/PRODUCT_DISCOVERY.md",
  requirements: ["DEMO_MODE=true"],
  implementation: "implemented",
  notes: "Returns clearly-labelled demo candidates so the pipeline can be exercised without credentials. Never runs outside DEMO_MODE.",
  isConfigured: () => isDemoMode(),
  async discover(query) {
    return DEMO_DISCOVERY_POOL.filter((p) => query.maxPriceUsd === undefined || (p.sellingPrice ?? 0) <= query.maxPriceUsd).slice(0, query.limit);
  },
};

// ── Interface-only adapters (need approved partner apps / paid or gated access) ──
function interfaceAdapter(def: Omit<SourceAdapter, "implementation" | "isConfigured" | "discover"> & { credentialKeys: string[] }): SourceAdapter {
  return {
    ...def,
    implementation: "interface",
    isConfigured: (creds) => def.credentialKeys.every((k) => !!creds[k]),
    async discover() {
      throw new IntegrationNotConfiguredError(def.label, [...def.requirements, "This adapter ships as an interface: implement discover() once your app/API access is approved (see docs/PRODUCT_DISCOVERY.md)."]);
    },
  };
}

export const aliexpressAdapter = interfaceAdapter({
  key: "ALIEXPRESS",
  label: "AliExpress (Open Platform / Affiliate API)",
  kind: "supplier",
  officialApi: true,
  docsUrl: "https://openservice.aliexpress.com",
  requirements: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "Approved AliExpress Open Platform app (affiliate or dropshipping solution)"],
  credentialKeys: ["appKey", "appSecret"],
  notes: "Use aliexpress.affiliate.product.query / hotproduct.query once your app is approved.",
});

export const amazonAdapter = interfaceAdapter({
  key: "AMAZON",
  label: "Amazon (Product Advertising API)",
  kind: "marketplace",
  officialApi: true,
  docsUrl: "https://webservices.amazon.com/paapi5/documentation/",
  requirements: ["AMAZON_PAAPI_ACCESS_KEY", "AMAZON_PAAPI_SECRET_KEY", "AMAZON_PARTNER_TAG", "An Associates account in good standing with qualifying sales (Amazon gates API access)"],
  credentialKeys: ["accessKey", "secretKey", "partnerTag"],
  notes: "Scraping Amazon violates its terms — FORGE only supports the official API. Check whether your region has migrated to Amazon's successor API.",
});

export const tiktokShopAdapter = interfaceAdapter({
  key: "TIKTOK_SHOP",
  label: "TikTok Shop (Partner API)",
  kind: "marketplace",
  officialApi: true,
  docsUrl: "https://partner.tiktokshop.com",
  requirements: ["Approved TikTok Shop Partner Center app", "App key + secret", "Seller or affiliate authorization"],
  credentialKeys: ["appKey", "appSecret", "accessToken"],
});

export const dsersAdapter = interfaceAdapter({
  key: "DSERS",
  label: "DSers-compatible suppliers",
  kind: "supplier",
  officialApi: false,
  docsUrl: "https://www.dsers.com",
  requirements: ["DSers has no public product-discovery API — discover via AliExpress, then fulfil through DSers inside Shopify"],
  credentialKeys: ["__never__"],
});

export const socialTrendAdapter = interfaceAdapter({
  key: "SOCIAL_TREND",
  label: "Social trend signals (Pinterest Trends / TikTok Research API)",
  kind: "trend",
  officialApi: true,
  docsUrl: "https://developers.pinterest.com/docs/api/v5/trends-list/",
  requirements: ["Pinterest API app with trends access, or TikTok Research API approval (academic/commercial eligibility applies)"],
  credentialKeys: ["accessToken"],
});

export const shopifySupplierAdapter: SourceAdapter = {
  key: "SHOPIFY_SUPPLIER",
  label: "Shopify-compatible supplier catalog",
  kind: "supplier",
  officialApi: true,
  docsUrl: "https://shopify.dev/docs/api/admin-graphql",
  requirements: ["A connected Shopify store (Settings → Shopify) whose catalog is synced by a supplier app (e.g. DSers, Syncee, Spocket)"],
  implementation: "implemented",
  notes: "Imports products that supplier apps have synced into your Shopify store, via the Admin GraphQL API.",
  isConfigured: () => !!(env().SHOPIFY_ACCESS_TOKEN && env().SHOPIFY_SHOP_DOMAIN),
  async discover(query) {
    const { fetchShopifyCatalog } = await import("../integrations/shopify");
    return fetchShopifyCatalog(query.limit, query.keywords);
  },
};

export const ADAPTERS: SourceAdapter[] = [
  manualImportAdapter,
  affiliateFeedAdapter,
  cjAdapter,
  shopifySupplierAdapter,
  wikipediaTrendsAdapter,
  aliexpressAdapter,
  amazonAdapter,
  tiktokShopAdapter,
  dsersAdapter,
  socialTrendAdapter,
  demoAdapter,
];

export function getAdapter(key: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.key === key);
}
