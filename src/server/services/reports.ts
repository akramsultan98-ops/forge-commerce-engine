// Automated Top 5 product intelligence report (daily / weekly).

import { and, desc, eq, inArray } from "drizzle-orm";
import { formatMoney, suggestPrice } from "@/domain/money";
import type { Provenance } from "@/lib/constants";
import type { ServiceContext } from "../context";
import { categories, productResearch, productSignals, products, reports, type Product, type ProductResearch, type SourceEvidence } from "../db/schema";
import { getSetting } from "../settings";
import { notify } from "./notifications";

export interface Top5Entry {
  rank: number;
  productId: string;
  title: string;
  slug: string;
  imageUrl: string | null;
  category: string | null;
  overallScore: number | null;
  confidence: number | null;
  verdict: string;
  thesis: string;
  whyTrending: string;
  estimatedDemand: string;
  estimatedCompetition: string;
  supplierCost: string;
  suggestedPrice: string;
  estimatedMargin: string;
  affiliateCommission: string;
  contentOpportunity: string;
  targetCustomer: string;
  marketingAngle: string;
  tiktokHook: string;
  landingAngle: string;
  riskLevel: string;
  sourceEvidence: SourceEvidence[];
  recommendedAction: string;
  provenanceMix: Partial<Record<Provenance, number>>;
  isDemo: boolean;
}

export async function selectTop5Candidates(ctx: ServiceContext, limit = 5): Promise<Product[]> {
  const discovery = await getSetting(ctx, "discovery");
  const rows = await ctx.db
    .select()
    .from(products)
    .where(and(eq(products.organizationId, ctx.orgId), inArray(products.status, ["DISCOVERED", "RESEARCHING", "APPROVED", "TESTING"])))
    .orderBy(desc(products.overallScore))
    .limit(50);
  return rows.filter((p) => p.overallScore !== null && !(discovery.excludeHighRisk && p.riskLevel === "HIGH")).slice(0, limit);
}

function provenanceMix(p: Product): Partial<Record<Provenance, number>> {
  const mix: Partial<Record<Provenance, number>> = {};
  for (const v of Object.values(p.fieldProvenance ?? {})) mix[v.p] = (mix[v.p] ?? 0) + 1;
  return mix;
}

async function evidenceFor(ctx: ServiceContext, p: Product, research: ProductResearch | null): Promise<SourceEvidence[]> {
  const signals = await ctx.db.select().from(productSignals).where(eq(productSignals.productId, p.id)).orderBy(desc(productSignals.observedAt)).limit(10);
  const seen = new Set<string>();
  const out: SourceEvidence[] = [];
  for (const s of signals) {
    if (seen.has(s.signal)) continue;
    seen.add(s.signal);
    out.push({ label: `${s.signal.replace(/_/g, " ")}: ${s.value} (${s.source})`, url: s.sourceUrl ?? undefined, provenance: s.provenance, observedAt: s.observedAt.toISOString() });
  }
  for (const e of research?.sourceEvidence ?? []) if (!out.some((o) => o.label === e.label)) out.push(e);
  if (p.supplierUrl) out.push({ label: "Supplier listing", url: p.supplierUrl, provenance: p.fieldProvenance?.cost?.p ?? "MANUAL" });
  if (!out.length) out.push({ label: p.isDemo ? "Demo seed data — no live evidence" : "No external evidence recorded yet", provenance: p.isDemo ? "DEMO" : "MANUAL" });
  return out;
}

export function composeEntry(rank: number, p: Product, categoryName: string | null, research: ProductResearch | null, evidence: SourceEvidence[]): Top5Entry {
  const c = p.currency;
  const suggested = research?.pricing?.suggestedPrice ?? (p.businessModel !== "AFFILIATE" && p.cost !== null ? suggestPrice(p.cost, p.shippingCost ?? 0) : p.sellingPrice);
  const commission = p.affiliateCommission ?? (p.sellingPrice && p.commissionPercentage ? (p.sellingPrice * p.commissionPercentage) / 100 : null);
  return {
    rank,
    productId: p.id,
    title: p.title,
    slug: p.slug,
    imageUrl: p.imageUrl,
    category: categoryName,
    overallScore: p.overallScore,
    confidence: p.scoreConfidence,
    verdict: research?.verdict ?? "UNRESEARCHED",
    thesis: research?.thesis ?? "Research pending.",
    whyTrending: research?.whyTrending ?? "No research yet.",
    estimatedDemand: research?.demand ?? "—",
    estimatedCompetition: research?.competition ?? "—",
    supplierCost: p.cost !== null ? formatMoney(p.cost, c) : p.businessModel === "AFFILIATE" ? "n/a (affiliate)" : "unknown",
    suggestedPrice: suggested !== null && suggested !== undefined ? formatMoney(suggested, c) : "—",
    estimatedMargin: p.estimatedMargin !== null ? `${Math.round(p.estimatedMargin)}%${p.businessModel === "AFFILIATE" ? " commission" : " gross"}` : "—",
    affiliateCommission: commission !== null ? `${formatMoney(commission, c)}${p.commissionPercentage ? ` (${p.commissionPercentage}%)` : ""}` : "—",
    contentOpportunity: research?.contentOpportunity ?? "—",
    targetCustomer: research?.targetCustomer ?? p.targetAudience ?? "—",
    marketingAngle: research?.marketingAngles?.[0] ?? "—",
    tiktokHook: research?.hooks?.[0] ?? "—",
    landingAngle: research?.landingAngle ?? "—",
    riskLevel: research?.riskLevel ?? p.riskLevel ?? "—",
    sourceEvidence: evidence,
    recommendedAction: research?.recommendedAction ?? "Run research first.",
    provenanceMix: provenanceMix(p),
    isDemo: p.isDemo,
  };
}

/** Builds and stores the report. `ensureResearch` lets the Reporting agent run research for candidates that lack it. */
export async function generateTop5Report(ctx: ServiceContext, type: "TOP5_DAILY" | "TOP5_WEEKLY", ensureResearch?: (productId: string) => Promise<void>) {
  const candidates = await selectTop5Candidates(ctx);
  const entries: Top5Entry[] = [];
  for (const [i, p] of candidates.entries()) {
    let [research] = await ctx.db.select().from(productResearch).where(eq(productResearch.productId, p.id)).orderBy(desc(productResearch.createdAt)).limit(1);
    if (!research && ensureResearch) {
      await ensureResearch(p.id);
      [research] = await ctx.db.select().from(productResearch).where(eq(productResearch.productId, p.id)).orderBy(desc(productResearch.createdAt)).limit(1);
    }
    const [fresh] = await ctx.db.select().from(products).where(eq(products.id, p.id)).limit(1);
    const [cat] = fresh.categoryId ? await ctx.db.select({ name: categories.name }).from(categories).where(eq(categories.id, fresh.categoryId)).limit(1) : [];
    entries.push(composeEntry(i + 1, fresh, cat?.name ?? null, research ?? null, await evidenceFor(ctx, fresh, research ?? null)));
  }
  const now = new Date();
  const periodStart = new Date(now.getTime() - (type === "TOP5_WEEKLY" ? 7 : 1) * 86400_000);
  const isDemo = entries.length > 0 && entries.every((e) => e.isDemo);
  const [row] = await ctx.db
    .insert(reports)
    .values({
      organizationId: ctx.orgId,
      type,
      periodStart,
      periodEnd: now,
      isDemo,
      content: {
        title: type === "TOP5_WEEKLY" ? "Weekly Top 5 products to test" : "Daily Top 5 products to test",
        entries,
        note: "Scores combine the signals FORGE holds for each product. Every metric carries its provenance; FORGE never presents estimates or AI inference as real sales data.",
        demo: isDemo,
      },
    })
    .returning();
  await notify(ctx, { type: "REPORT_READY", severity: "info", title: `${row.content.title as string} is ready`, body: entries.map((e) => `${e.rank}. ${e.title} — ${e.overallScore ?? "–"}/100`).join("\n") || "No eligible products yet.", entity: { type: "report", id: row.id }, dedupeHours: 0 });
  return row;
}

export async function latestReport(ctx: Pick<ServiceContext, "db" | "orgId">, type?: "TOP5_DAILY" | "TOP5_WEEKLY") {
  const [row] = await ctx.db
    .select()
    .from(reports)
    .where(and(eq(reports.organizationId, ctx.orgId), type ? eq(reports.type, type) : undefined))
    .orderBy(desc(reports.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listReports(ctx: Pick<ServiceContext, "db" | "orgId">, limit = 20) {
  return ctx.db.select({ id: reports.id, type: reports.type, createdAt: reports.createdAt, isDemo: reports.isDemo }).from(reports).where(eq(reports.organizationId, ctx.orgId)).orderBy(desc(reports.createdAt)).limit(limit);
}

export async function getReport(ctx: Pick<ServiceContext, "db" | "orgId">, id: string) {
  const [row] = await ctx.db.select().from(reports).where(and(eq(reports.id, id), eq(reports.organizationId, ctx.orgId))).limit(1);
  return row ?? null;
}
