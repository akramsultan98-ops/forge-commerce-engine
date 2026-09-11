// Product Discovery Engine: runs configured source adapters, upserts candidates with provenance,
// imports CSV feeds, refreshes trend signals and checks availability.

import { and, eq, isNotNull } from "drizzle-orm";
import { mapProductCsv } from "@/domain/csv";
import { convert } from "@/domain/money";
import type { SourceAdapterKey } from "@/lib/constants";
import { assertCan, type ServiceContext } from "../context";
import { productSignals, productSources, products } from "../db/schema";
import { isDemoMode } from "../env";
import { decryptJson, encryptJson } from "../security/crypto";
import { getSetting } from "../settings";
import { audit } from "../audit";
import { ValidationError } from "../errors";
import { categoryIdFor, supplierIdFor } from "../services/catalog";
import { applyProductFacts, createProduct } from "../services/products";
import { scoreProductById } from "../services/scoring";
import { notify } from "../services/notifications";
import { ADAPTERS, getAdapter, wikipediaTrendsAdapter } from "./adapters";
import type { DiscoveredProduct } from "./types";

/** Makes sure each adapter has a product_sources row so the Sources page can show its setup state. */
export async function ensureSources(ctx: ServiceContext) {
  const existing = await ctx.db.select().from(productSources).where(eq(productSources.organizationId, ctx.orgId));
  for (const a of ADAPTERS) {
    if (existing.some((s) => s.adapter === a.key)) continue;
    const configured = a.isConfigured({}, {});
    await ctx.db.insert(productSources).values({
      organizationId: ctx.orgId,
      adapter: a.key,
      name: a.label,
      status: a.key === "DEMO" ? (isDemoMode() ? "DEMO" : "DISABLED") : configured ? "CONNECTED" : "NOT_CONFIGURED",
      enabled: a.implementation === "implemented" && configured,
    });
  }
  return ctx.db.select().from(productSources).where(eq(productSources.organizationId, ctx.orgId));
}

export async function saveSourceConfig(ctx: ServiceContext, sourceId: string, input: { config?: Record<string, unknown>; credentials?: Record<string, string>; enabled?: boolean }) {
  assertCan(ctx, "integrations:manage");
  const [src] = await ctx.db.select().from(productSources).where(and(eq(productSources.id, sourceId), eq(productSources.organizationId, ctx.orgId))).limit(1);
  if (!src) throw new ValidationError("Unknown source");
  const adapter = getAdapter(src.adapter);
  const config = { ...(src.config ?? {}), ...(input.config ?? {}) };
  if (typeof config.feedUrl === "string" && config.feedUrl && !/^https:\/\//.test(config.feedUrl)) throw new ValidationError("Feed URL must be https://");
  const creds = { ...(decryptJson<Record<string, string>>(src.credentialsEncrypted) ?? {}), ...(input.credentials ?? {}) };
  const configured = adapter?.isConfigured(creds, config) ?? false;
  await ctx.db
    .update(productSources)
    .set({
      config,
      credentialsEncrypted: Object.keys(creds).length ? encryptJson(creds) : null,
      enabled: input.enabled ?? src.enabled,
      status: src.adapter === "DEMO" ? src.status : configured ? "CONNECTED" : "NOT_CONFIGURED",
    })
    .where(eq(productSources.id, sourceId));
  await audit(ctx, "source.configure", { type: "product_source", id: sourceId }, { adapter: src.adapter, configKeys: Object.keys(input.config ?? {}), credentialKeys: Object.keys(input.credentials ?? {}) });
}

async function upsertDiscovered(ctx: ServiceContext, d: DiscoveredProduct, source: { key: SourceAdapterKey; id: string | null }) {
  const [existing] = await ctx.db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.organizationId, ctx.orgId), eq(products.source, source.key), eq(products.sourceProductId, d.sourceProductId)))
    .limit(1);
  const facts = {
    cost: d.cost,
    sellingPrice: d.sellingPrice,
    shippingCost: d.shippingCost,
    commissionPercentage: d.commissionPercentage,
    affiliateCommission: d.affiliateCommission,
    shippingDaysMin: d.shippingDaysMin,
    shippingDaysMax: d.shippingDaysMax,
    rating: d.rating,
    reviewCount: d.reviewCount,
    reviewGrowth: d.reviewGrowth,
    estimatedSales: d.estimatedSales,
    sellerCount: d.sellerCount,
    trendScore: d.trendScore,
    competitionScore: d.competitionScore,
    contentScore: d.contentScore,
    impulseScore: d.impulseScore,
    problemScore: d.problemScore,
    noveltyScore: d.noveltyScore,
    saturationScore: d.saturationScore,
  };
  const defined = Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)) as Record<string, number>;
  if (existing) {
    await applyProductFacts(ctx, existing.id, defined, d.provenance, d.sourceLabel);
    return { id: existing.id, created: false };
  }
  const systemCtx = { ...ctx, role: "admin" as const };
  const created = await createProduct(
    systemCtx,
    {
      title: d.title,
      description: d.description,
      categoryId: await categoryIdFor(systemCtx, d.category),
      brand: d.brand,
      supplierId: await supplierIdFor(systemCtx, d.supplierName, source.key === "CJ" ? "CJ" : "MANUAL_IMPORT"),
      supplierUrl: d.supplierUrl,
      productUrl: d.productUrl,
      affiliateUrl: d.affiliateUrl,
      imageUrl: d.imageUrl,
      currency: (["USD", "EUR", "EGP", "GBP", "SAR", "AED"].includes(d.currency) ? d.currency : "USD") as "USD",
      countriesAvailable: d.countriesAvailable,
      businessModel: d.businessModel ?? "AFFILIATE",
      trendKeyword: d.trendKeyword,
      targetAudience: d.targetAudience,
      problemSolved: d.problemSolved,
      highlights: d.highlights,
      tags: d.tags,
      ...defined,
    },
    { provenance: d.provenance, source: source.key, sourceId: source.id, sourceProductId: d.sourceProductId, sourceLabel: d.sourceLabel, isDemo: d.provenance === "DEMO", skipAudit: true },
  );
  return { id: created.id, created: true };
}

export interface DiscoveryRunSummary {
  adapters: Array<{ adapter: string; status: "ok" | "skipped" | "error"; found: number; created: number; message?: string }>;
  created: string[];
  opportunities: number;
}

export async function runDiscovery(ctx: ServiceContext, opts: { keywords?: string[]; limit?: number; adapters?: string[] } = {}): Promise<DiscoveryRunSummary> {
  const [discovery, markets] = await Promise.all([getSetting(ctx, "discovery"), getSetting(ctx, "markets")]);
  const sources = await ensureSources(ctx);
  const summary: DiscoveryRunSummary = { adapters: [], created: [], opportunities: 0 };
  for (const src of sources) {
    const adapter = getAdapter(src.adapter);
    if (!adapter?.discover || adapter.kind === "trend" || adapter.key === "MANUAL_IMPORT") continue;
    if (opts.adapters?.length && !opts.adapters.includes(adapter.key)) continue;
    if (adapter.key === "DEMO" && !isDemoMode()) continue;
    const creds = decryptJson<Record<string, string>>(src.credentialsEncrypted) ?? {};
    if (!src.enabled && adapter.key !== "DEMO") {
      summary.adapters.push({ adapter: adapter.key, status: "skipped", found: 0, created: 0, message: adapter.isConfigured(creds, src.config) ? "disabled" : "not configured" });
      continue;
    }
    try {
      const found = await adapter.discover({ market: markets.primary, keywords: opts.keywords ?? [], maxPriceUsd: discovery.maxPriceUsd, limit: opts.limit ?? 25 }, creds, src.config ?? {});
      let created = 0;
      for (const d of found) {
        const r = await upsertDiscovered(ctx, d, { key: adapter.key, id: src.id });
        if (r.created) {
          created++;
          summary.created.push(r.id);
        }
      }
      await ctx.db.update(productSources).set({ lastRunAt: new Date(), lastError: null, lastResultCount: found.length }).where(eq(productSources.id, src.id));
      summary.adapters.push({ adapter: adapter.key, status: "ok", found: found.length, created });
    } catch (err) {
      const message = err instanceof Error ? err.message : "failed";
      await ctx.db.update(productSources).set({ lastRunAt: new Date(), lastError: message, status: "ERROR" }).where(eq(productSources.id, src.id));
      summary.adapters.push({ adapter: adapter.key, status: "error", found: 0, created: 0, message });
    }
  }
  if (discovery.autoScoreNewProducts) {
    for (const id of summary.created) {
      const s = await scoreProductById(ctx, id);
      if (s.overall >= discovery.minScoreToApprove && !(discovery.excludeHighRisk && s.riskLevel === "HIGH")) {
        summary.opportunities++;
        const [p] = await ctx.db.select({ title: products.title, isDemo: products.isDemo }).from(products).where(eq(products.id, id)).limit(1);
        await notify(ctx, { type: "NEW_OPPORTUNITY", severity: "success", title: `New product opportunity: ${p.title}`, body: `Scored ${s.overall}/100 (confidence ${s.confidence}). ${s.reasons.slice(0, 2).join("; ")}${p.isDemo ? " — DEMO data." : ""}`, entity: { type: "product", id } });
      }
    }
  }
  return summary;
}

export async function importCsv(ctx: ServiceContext, text: string, opts: { defaultBusinessModel?: "AFFILIATE" | "DROPSHIPPING" | "SHOPIFY" | "LANDING_PAGE" } = {}) {
  assertCan(ctx, "products:write");
  if (text.length > 5_000_000) throw new ValidationError("CSV is larger than 5 MB");
  const mapped = mapProductCsv(text);
  let created = 0;
  let updated = 0;
  const createdIds: string[] = [];
  for (const row of mapped.rows) {
    const r = await upsertDiscovered(
      ctx,
      {
        ...row,
        sourceProductId: row.sourceProductId ?? row.productUrl ?? row.title,
        currency: row.currency ?? "USD",
        businessModel: row.businessModel ?? opts.defaultBusinessModel ?? "AFFILIATE",
        provenance: "MANUAL",
        sourceLabel: "CSV import",
      },
      { key: "MANUAL_IMPORT", id: null },
    );
    if (r.created) {
      created++;
      createdIds.push(r.id);
    } else updated++;
  }
  for (const id of createdIds) await scoreProductById(ctx, id);
  await audit(ctx, "products.import_csv", { type: "product" }, { created, updated, errors: mapped.errors.length });
  return { created, updated, errors: mapped.errors, unknownColumns: mapped.unknownColumns, createdIds };
}

/** trend_refresh job: pulls REAL interest signals for every product with a trend keyword. */
export async function refreshTrendSignals(ctx: ServiceContext) {
  if (!wikipediaTrendsAdapter.isConfigured({}, {})) return { refreshed: 0, skipped: "TRENDS_WIKIPEDIA_ENABLED=false" };
  const rows = await ctx.db.select({ id: products.id, keyword: products.trendKeyword }).from(products).where(and(eq(products.organizationId, ctx.orgId), isNotNull(products.trendKeyword)));
  let refreshed = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const signals = await wikipediaTrendsAdapter.signals!(r.keyword!, {});
      if (!signals.length) continue;
      await ctx.db.insert(productSignals).values(signals.map((s) => ({ productId: r.id, signal: s.signal, value: s.value, provenance: s.provenance, source: s.source, sourceUrl: s.sourceUrl ?? null, meta: s.meta ?? {} })));
      const idx = signals.find((s) => s.signal === "trend_index");
      if (idx) {
        await applyProductFacts(ctx, r.id, { trendScore: idx.value }, "REAL", idx.source);
        await scoreProductById(ctx, r.id);
      }
      refreshed++;
    } catch (err) {
      errors.push(`${r.keyword}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  return { refreshed, candidates: rows.length, errors: errors.slice(0, 10) };
}

export function priceInUsd(amount: number | null, currency: string, rates: Record<string, number>) {
  return amount === null ? null : convert(amount, currency, "USD", rates);
}
