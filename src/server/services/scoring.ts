import { and, desc, eq, inArray } from "drizzle-orm";
import { MARKETS, type ProductStatus } from "@/lib/constants";
import { scoreProduct, type ScoreResult, type ScoringInput } from "@/domain/scoring";
import { convert } from "@/domain/money";
import type { ServiceContext } from "../context";
import { categories, productScores, products, type Product } from "../db/schema";
import { getSetting } from "../settings";
import { getProduct } from "./products";

export function toScoringInput(p: Product, opts: { categorySlug?: string | null; targetCountries?: string[]; rates?: Record<string, number> } = {}): ScoringInput {
  const provenance = Object.fromEntries(Object.entries(p.fieldProvenance ?? {}).map(([k, v]) => [k, v.p]));
  return {
    title: p.title,
    description: p.description,
    categorySlug: opts.categorySlug ?? null,
    tags: p.tags,
    businessModel: p.businessModel,
    currency: p.currency,
    priceUsd: p.sellingPrice !== null ? convert(p.sellingPrice, p.currency, "USD", opts.rates) : null,
    cost: p.cost,
    sellingPrice: p.sellingPrice,
    shippingCost: p.shippingCost,
    affiliateCommission: p.affiliateCommission,
    commissionPercentage: p.commissionPercentage,
    shippingDaysMin: p.shippingDaysMin,
    shippingDaysMax: p.shippingDaysMax,
    countriesAvailable: p.countriesAvailable,
    targetCountries: opts.targetCountries,
    rating: p.rating,
    reviewCount: p.reviewCount,
    reviewGrowth: p.reviewGrowth,
    estimatedSales: p.estimatedSales,
    salesVelocity: p.salesVelocity,
    sellerCount: p.sellerCount,
    adActivity: p.adActivity,
    trendScore: p.trendScore,
    competitionScore: p.competitionScore,
    contentScore: p.contentScore,
    impulseScore: p.impulseScore,
    problemScore: p.problemScore,
    noveltyScore: p.noveltyScore,
    saturationScore: p.saturationScore,
    marginScore: p.marginScore,
    provenance,
  };
}

async function scoringContext(ctx: ServiceContext) {
  const [weights, markets, currency] = await Promise.all([getSetting(ctx, "scoring.weights"), getSetting(ctx, "markets"), getSetting(ctx, "currency")]);
  const primary = MARKETS.find((m) => m.code === markets.primary);
  return { weights, targetCountries: primary ? [...primary.countries] : [], rates: currency.rates };
}

async function persist(ctx: ServiceContext, p: Product, result: ScoreResult) {
  const [row] = await ctx.db
    .insert(productScores)
    .values({
      productId: p.id,
      overall: result.overall,
      confidence: result.confidence,
      factors: Object.fromEntries(Object.entries(result.factors).map(([k, f]) => [k, { score: f.score, weight: f.weight, provenance: f.provenance, note: f.note }])),
      weights: result.weights,
      reasons: result.reasons,
      warnings: result.warnings,
      riskLevel: result.riskLevel,
      engineVersion: result.engineVersion,
    })
    .returning({ id: productScores.id });
  await ctx.db
    .update(products)
    .set({ overallScore: result.overall, scoreConfidence: result.confidence, riskLevel: result.riskLevel, riskFlags: result.riskFlags })
    .where(eq(products.id, p.id));
  return row.id;
}

export async function scoreProductById(ctx: ServiceContext, productId: string): Promise<ScoreResult & { scoreId: string }> {
  const p = await getProduct(ctx, productId);
  const [cat] = p.categoryId ? await ctx.db.select({ slug: categories.slug }).from(categories).where(eq(categories.id, p.categoryId)).limit(1) : [];
  const sc = await scoringContext(ctx);
  const result = scoreProduct(toScoringInput(p, { categorySlug: cat?.slug, targetCountries: sc.targetCountries, rates: sc.rates }), sc.weights);
  const scoreId = await persist(ctx, p, result);
  return { ...result, scoreId };
}

export async function scoreAllProducts(ctx: ServiceContext, statuses: ProductStatus[] = ["DISCOVERED", "RESEARCHING", "APPROVED", "TESTING", "WINNER", "SCALING", "PAUSED"]) {
  const sc = await scoringContext(ctx);
  const rows = await ctx.db
    .select({ p: products, slug: categories.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.organizationId, ctx.orgId), inArray(products.status, statuses)));
  let scored = 0;
  for (const { p, slug } of rows) {
    await persist(ctx, p, scoreProduct(toScoringInput(p, { categorySlug: slug, targetCountries: sc.targetCountries, rates: sc.rates }), sc.weights));
    scored++;
  }
  return { scored };
}

export async function latestScore(ctx: Pick<ServiceContext, "db">, productId: string) {
  const [row] = await ctx.db.select().from(productScores).where(eq(productScores.productId, productId)).orderBy(desc(productScores.createdAt)).limit(1);
  return row ?? null;
}

/** Latest score row per product in one query (DISTINCT ON). */
export async function latestScores(ctx: Pick<ServiceContext, "db">, productIds: string[]) {
  if (!productIds.length) return new Map<string, typeof productScores.$inferSelect>();
  const rows = await ctx.db
    .selectDistinctOn([productScores.productId])
    .from(productScores)
    .where(inArray(productScores.productId, productIds))
    .orderBy(productScores.productId, desc(productScores.createdAt));
  return new Map(rows.map((r) => [r.productId, r]));
}

export async function scoreHistory(ctx: Pick<ServiceContext, "db">, productId: string, limit = 20) {
  return ctx.db
    .select({ overall: productScores.overall, confidence: productScores.confidence, createdAt: productScores.createdAt })
    .from(productScores)
    .where(eq(productScores.productId, productId))
    .orderBy(desc(productScores.createdAt))
    .limit(limit);
}
