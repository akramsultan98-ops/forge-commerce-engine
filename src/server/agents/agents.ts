// FORGE agents. Each agent is a small, single-purpose unit with a typed input/output, recorded by
// the runtime. New agents: implement AgentDef and add them to AGENTS (see docs/AI_AGENTS.md).

import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ContentAngle, ContentType, LandingTemplate, Platform } from "@/lib/constants";
import { TEMPLATE_LAYOUTS } from "@/lib/landing-sections";
import { round } from "@/lib/utils";
import { categories, productResearch, productSignals, products, type Product } from "../db/schema";
import { buildBrief, briefToPrompt, type ProductBrief } from "../ai/brief";
import { ConceptBatchSchema, CopySchema, ResearchSchema, type ContentConcept, type CopyOutput } from "../ai/schemas";
import { aiStructured } from "../ai/service";
import { templateConcepts, templateCopy, templateLandingSections, templateResearch } from "../ai/templates";
import { getSetting } from "../settings";
import { applyProductFacts, getProduct, listProducts, setProductStatus } from "../services/products";
import { latestScore, scoreAllProducts, scoreProductById } from "../services/scoring";
import { createLandingPage } from "../services/landing-pages";
import { createContentFromConcepts, contentPerformance, summarizeWinners } from "../services/content";
import { detectSpikes, syncProductMetrics } from "../services/analytics";
import { notify } from "../services/notifications";
import { evaluateAllTests } from "../services/testing";
import { refreshRecommendations, saveRecommendations, type RecommendationDraft } from "../services/recommendations";
import { generateTop5Report } from "../services/reports";
import { refreshTrendSignals } from "../discovery/service";
import { isDemoMode } from "../env";
import { leaderboard, rangeForDays } from "../services/analytics";
import { runAgent, type AgentContext, type AgentDef } from "./runtime";

async function briefFor(ctx: AgentContext, productId: string): Promise<{ product: Product; brief: ProductBrief }> {
  const product = await getProduct(ctx, productId);
  const [cat] = product.categoryId ? await ctx.db.select().from(categories).where(eq(categories.id, product.categoryId)).limit(1) : [];
  const score = await latestScore(ctx, productId);
  return { product, brief: buildBrief(product, cat ?? null, score) };
}

// ── Product Research Agent ──────────────────────────────────────────────────
export const ResearchInput = z.union([
  z.object({ productId: z.string().uuid() }),
  z.object({
    market: z.string().default("US"),
    budget: z.number().min(0).optional(),
    businessModel: z.enum(["AFFILIATE", "DROPSHIPPING", "SHOPIFY", "LANDING_PAGE"]).optional(),
    desiredMarginPct: z.number().min(0).max(95).optional(),
    targetAudience: z.string().max(200).optional(),
    maxPriceUsd: z.number().positive().optional(),
    limit: z.number().int().min(1).max(20).default(10),
  }),
]);

export const researchAgent: AgentDef<z.input<typeof ResearchInput>, unknown> = {
  name: "research",
  title: "Product Research Agent",
  description: "Investigates demand, trend, competition, pricing, supply, shipping, social and content potential and risks; writes an investment-style thesis (“TEST THIS PRODUCT BECAUSE…” / “DO NOT TEST…”).",
  tier: "strong",
  async run(ctx, raw) {
    const input = ResearchInput.parse(raw);
    if ("productId" in input) return researchProduct(ctx, input.productId);
    // Portfolio mode: rank candidates against the operator's constraints, research the best few.
    const { items } = await listProducts(ctx, { status: ["DISCOVERED", "RESEARCHING", "APPROVED", "TESTING"], businessModel: input.businessModel, maxPrice: input.maxPriceUsd, limit: 100 });
    const aud = (input.targetAudience ?? "").toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const ranked = items
      .filter((p) => input.desiredMarginPct === undefined || (p.estimatedMargin ?? 0) >= input.desiredMarginPct)
      .filter((p) => input.budget === undefined || input.budget <= 0 || p.businessModel === "AFFILIATE" || (p.cost ?? 0) * 20 <= input.budget)
      .map((p) => {
        const fit = aud.length ? aud.filter((w) => `${p.targetAudience ?? ""} ${p.title} ${p.problemSolved ?? ""}`.toLowerCase().includes(w)).length * 3 : 0;
        return { p, fitScore: round((p.overallScore ?? 0) + fit - (p.riskLevel === "HIGH" ? 25 : 0)) };
      })
      .sort((a, b) => b.fitScore - a.fitScore)
      .slice(0, input.limit);
    ctx.step(`Ranked ${ranked.length} candidates for market ${input.market}`);
    const out = [];
    for (const [i, r] of ranked.entries()) {
      const [existing] = await ctx.db.select().from(productResearch).where(and(eq(productResearch.productId, r.p.id), gte(productResearch.createdAt, new Date(Date.now() - 7 * 86400_000)))).orderBy(desc(productResearch.createdAt)).limit(1);
      // Cost control: only research the top 3 fresh; reuse research younger than 7 days.
      const research = existing ?? (i < 3 ? (await researchProduct(ctx, r.p.id)).research : null);
      out.push({ rank: i + 1, productId: r.p.id, title: r.p.title, score: r.p.overallScore, fitScore: r.fitScore, verdict: research?.verdict ?? "UNRESEARCHED", thesis: research?.thesis ?? null, antiThesis: research?.antiThesis ?? null, isDemo: r.p.isDemo });
    }
    return { market: input.market, constraints: input, ranked: out };
  },
};

async function researchProduct(ctx: AgentContext, productId: string) {
  const { product, brief } = await briefFor(ctx, productId);
  ctx.step(`Researching “${product.title}”`);
  const result = await aiStructured(ctx, {
    task: "research",
    schema: ResearchSchema,
    schemaName: "product_research",
    system: "You are FORGE's product research analyst. Judge the product like an investor judges a thesis. Use ONLY the fact sheet. If a signal is missing, say it is missing — never guess numbers. factorEstimates are qualitative 0-100 judgements (visual demo potential, problem strength, impulse appeal, novelty).",
    prompt: `${briefToPrompt(brief)}\n\nProduce the research report.`,
    fallback: () => templateResearch(brief),
    productId,
    agentRunId: ctx.runId,
    effort: "high",
  });
  const r = result.data;
  const signals = await ctx.db.select().from(productSignals).where(eq(productSignals.productId, productId)).orderBy(desc(productSignals.observedAt)).limit(5);
  const evidence = signals.map((s) => ({ label: `${s.signal.replace(/_/g, " ")} = ${s.value}`, url: s.sourceUrl ?? undefined, provenance: s.provenance, observedAt: s.observedAt.toISOString() }));
  const [research] = await ctx.db
    .insert(productResearch)
    .values({
      productId,
      agentRunId: ctx.runId,
      verdict: r.verdict,
      thesis: r.thesis,
      antiThesis: r.antiThesis,
      whyTrending: r.whyTrending,
      demand: r.demand,
      competition: r.competition,
      pricing: { supplierCost: product.cost, suggestedPrice: r.suggestedPrice, margin: product.estimatedMargin, commission: brief.commission, currency: product.currency },
      supplierNotes: r.supplierNotes,
      shippingNotes: r.shippingNotes,
      socialPotential: r.socialPotential,
      contentOpportunity: r.contentOpportunity,
      targetCustomer: r.targetCustomer,
      marketingAngles: r.marketingAngles,
      hooks: r.hooks,
      ctas: r.ctas,
      landingAngle: r.landingAngle,
      risks: r.risks,
      riskLevel: r.riskLevel,
      recommendedAction: r.recommendedAction,
      sourceEvidence: evidence,
      generationMethod: result.method,
      provenance: product.isDemo ? "DEMO" : result.method === "AI" ? "AI_INFERENCE" : "ESTIMATED",
      model: result.model,
    })
    .returning();
  if (result.method === "AI" && r.factorEstimates) {
    // AI judgement only fills gaps — it never overwrites real or operator data.
    await applyProductFacts(ctx, productId, r.factorEstimates, "AI_INFERENCE", `${result.provider}:${result.model}`, { onlyIfWeaker: true });
    await scoreProductById(ctx, productId);
  }
  if (product.status === "DISCOVERED") await setProductStatus({ ...ctx, role: "admin" }, productId, "RESEARCHING", "Research completed");
  ctx.step(`Verdict ${r.verdict} via ${result.method}${result.note ? ` (${result.note})` : ""}`);
  return { research, method: result.method, note: result.note };
}

// ── Trend Intelligence Agent ────────────────────────────────────────────────
export const trendAgent: AgentDef<Record<string, never>, unknown> = {
  name: "trend",
  title: "Trend Intelligence Agent",
  description: "Refreshes real interest signals (Wikimedia pageviews today; more sources as they are connected) and re-scores affected products.",
  tier: "none",
  async run(ctx) {
    const r = await refreshTrendSignals(ctx);
    ctx.step(`Refreshed ${r.refreshed} products`);
    return r;
  },
};

// ── Product Scoring Agent ───────────────────────────────────────────────────
export const scoringAgent: AgentDef<{ productId?: string }, unknown> = {
  name: "scoring",
  title: "Product Scoring Agent",
  description: "Runs the explainable 0–100 weighted scoring engine (configurable weights) and stores reasons, warnings, risk and confidence.",
  tier: "none",
  async run(ctx, input) {
    if (input.productId) {
      const s = await scoreProductById(ctx, input.productId);
      return { overall: s.overall, confidence: s.confidence, reasons: s.reasons, warnings: s.warnings };
    }
    return scoreAllProducts(ctx);
  },
};

// ── Copywriting Agent ───────────────────────────────────────────────────────
export const copywritingAgent: AgentDef<{ productId: string }, { copy: CopyOutput; method: "AI" | "TEMPLATE"; model: string }> = {
  name: "copywriting",
  title: "Copywriting Agent",
  description: "Writes product copy, headlines, hooks, CTAs, FAQs, email copy and SEO metadata. Direct, human, persuasive — never spammy, never fabricated.",
  tier: "fast",
  async run(ctx, { productId }) {
    const { brief } = await briefFor(ctx, productId);
    const store = await getSetting(ctx, "storefront");
    const result = await aiStructured(ctx, {
      task: "copywriting",
      schema: CopySchema,
      schemaName: "product_copy",
      system:
        "You are FORGE's copywriter. Direct, modern, human, persuasive. No corporate filler, no hype words (revolutionary, game-changer, must-have), no fake urgency or scarcity, no testimonials, no invented numbers. interestPoints explain why customers are interested, grounded in the fact sheet. FAQs must be answerable from the fact sheet or the provided policies.",
      prompt: `${briefToPrompt(brief)}\n\nShipping policy: ${store.shippingSummary}\nReturns policy: ${store.returnsSummary}\n\nWrite the full copy set.`,
      fallback: () => templateCopy(brief, { returns: store.returnsSummary, shipping: store.shippingSummary }),
      productId,
      agentRunId: ctx.runId,
    });
    ctx.step(`Copy written via ${result.method}`);
    return { copy: result.data, method: result.method, model: result.model };
  },
};

// ── Landing Page Agent ──────────────────────────────────────────────────────
export function chooseTemplate(p: Product): LandingTemplate {
  if ((p.sellingPrice ?? 0) >= 80) return "PREMIUM";
  if ((p.contentScore ?? 0) >= 82) return "VIRAL";
  if ((p.sellingPrice ?? 999) <= 25 && (p.impulseScore ?? 0) >= 70) return "IMPULSE";
  return "PROBLEM_SOLUTION";
}

export const landingPageAgent: AgentDef<{ productId: string; template?: LandingTemplate }, { landingPageId: string; slug: string; template: LandingTemplate; method: string }> = {
  name: "landing_page",
  title: "Landing Page Agent",
  description: "Builds a conversion-focused landing page (templates A–E) from the copy set, with SEO metadata, trust, shipping, returns and the affiliate disclosure.",
  tier: "fast",
  async run(ctx, input) {
    const { product, brief } = await briefFor(ctx, input.productId);
    const { output } = await runAgent(ctx, copywritingAgent, { productId: input.productId }, { parentRunId: ctx.runId, productId: input.productId });
    const template = input.template ?? chooseTemplate(product);
    const store = await getSetting(ctx, "storefront");
    const sections = templateLandingSections(brief, output.copy, TEMPLATE_LAYOUTS[template], { disclosure: store.affiliateDisclosure, returns: store.returnsSummary, shipping: store.shippingSummary, template });
    const heroHeadline = String(sections.find((s) => s.type === "HERO")?.content.headline ?? output.copy.headline);
    const page = await createLandingPage(ctx, {
      productId: product.id,
      productSlug: product.slug,
      template,
      headline: heroHeadline,
      subheadline: output.copy.subheadline,
      seoTitle: output.copy.seoTitle,
      metaDescription: output.copy.metaDescription,
      ctaLabel: output.copy.ctaLabel,
      sections,
      generationMethod: output.method,
      model: output.model,
      agentRunId: ctx.runId,
      isDemo: product.isDemo,
    });
    if (!product.description && output.copy.description) await ctx.db.update(products).set({ description: output.copy.description }).where(eq(products.id, product.id));
    ctx.step(`Landing page ${page.slug} (${template}) created`);
    return { landingPageId: page.id, slug: page.slug, template, method: output.method };
  },
};

// ── Content Agent ───────────────────────────────────────────────────────────
export const BATCHES: Record<string, Array<{ platform: Platform; contentType: ContentType; count: number }>> = {
  launch: [{ platform: "TIKTOK", contentType: "TIKTOK_VIDEO", count: 10 }],
  full: [
    { platform: "TIKTOK", contentType: "TIKTOK_VIDEO", count: 10 },
    { platform: "INSTAGRAM", contentType: "INSTAGRAM_REEL", count: 10 },
    { platform: "YOUTUBE", contentType: "YOUTUBE_SHORT", count: 10 },
    { platform: "PINTEREST", contentType: "PINTEREST_PIN", count: 10 },
    { platform: "INSTAGRAM", contentType: "STATIC_POST", count: 5 },
    { platform: "INSTAGRAM", contentType: "CAROUSEL", count: 5 },
    { platform: "INSTAGRAM", contentType: "EDUCATIONAL_POST", count: 5 },
    { platform: "FACEBOOK", contentType: "PROBLEM_SOLUTION_POST", count: 5 },
  ],
  scale: [
    { platform: "TIKTOK", contentType: "TIKTOK_VIDEO", count: 5 },
    { platform: "INSTAGRAM", contentType: "INSTAGRAM_REEL", count: 5 },
    { platform: "YOUTUBE", contentType: "YOUTUBE_SHORT", count: 5 },
  ],
};

const VIDEO_TYPES: ContentType[] = ["TIKTOK_VIDEO", "INSTAGRAM_REEL", "YOUTUBE_SHORT", "AD_CONCEPT"];

export interface ContentInput {
  productId: string;
  batch?: keyof typeof BATCHES;
  platform?: Platform;
  contentType?: ContentType;
  count?: number;
  angle?: ContentAngle;
  schedule?: boolean;
}

export const contentAgent: AgentDef<ContentInput, { created: number; groups: Array<{ platform: string; contentType: string; count: number; method: string }> }> = {
  name: "content",
  title: "Content Agent",
  description: "Generates short-form video concepts (hook 0–3s → problem → demo → payoff → CTA across 14 angles), Reels, Shorts, Pins, static, carousel, educational and problem/solution posts — each with tracked UTMs.",
  tier: "fast",
  async run(ctx, input) {
    const { product, brief } = await briefFor(ctx, input.productId);
    let groups = input.batch ? BATCHES[input.batch] : [{ platform: input.platform ?? "TIKTOK", contentType: input.contentType ?? "TIKTOK_VIDEO", count: Math.min(input.count ?? 10, 30) }];
    let angles: ContentAngle[] | undefined = input.angle ? [input.angle] : undefined;
    if (input.batch === "scale" && !angles) {
      const winners = summarizeWinners(await contentPerformance(ctx, { since: new Date(Date.now() - 30 * 86400_000), includeDemo: isDemoMode(), productId: product.id }));
      if (winners.angle?.key && winners.angle.key !== "—") angles = [winners.angle.key as ContentAngle];
      ctx.step(angles ? `Scaling winning angle ${angles[0]}` : "No winning angle yet — using a varied mix");
    }
    groups = groups.map((g) => ({ ...g, count: Math.max(1, Math.min(g.count, 30)) }));
    const summary: Array<{ platform: string; contentType: string; count: number; method: string }> = [];
    let created = 0;
    for (const g of groups) {
      const isVideo = VIDEO_TYPES.includes(g.contentType);
      const result = await aiStructured(ctx, {
        task: "content",
        schema: ConceptBatchSchema,
        schemaName: "content_concepts",
        system: [
          "You create short-form social content concepts for FORGE. Every concept must be filmable by one person with the product and a phone.",
          isVideo
            ? "Video beats (exact labels and timings): HOOK 0-3s, PROBLEM 3-7s, DEMONSTRATION 7-15s, PAYOFF 15-22s, CTA 22-26s. Each beat has a spoken/on-screen line and a visual direction."
            : "This is not a video: leave beats empty and put the post text / slide copy / pin description in body.",
          `Vary the angle across concepts using: ${angles?.join(", ") ?? "CURIOSITY, PROBLEM_SOLUTION, BEFORE_AFTER, POV, UNEXPECTED_USE, COMPARISON, EXPERIMENT, CHALLENGE, REACTION, EDUCATIONAL, UGC, UNBOXING, REVIEW, MYTH_BUSTING"}.`,
          "Captions must include a clear affiliate/ad disclosure when the business model is AFFILIATE. No fake reactions, no fake reviews, no invented results.",
        ].join("\n"),
        prompt: `${briefToPrompt(brief)}\n\nPlatform: ${g.platform}\nFormat: ${g.contentType}\nNumber of concepts: ${g.count}`,
        fallback: () => ({ concepts: templateConcepts(brief, { platform: g.platform, contentType: g.contentType, count: g.count, angles }) }),
        productId: product.id,
        agentRunId: ctx.runId,
        maxTokens: 16000,
      });
      const concepts: ContentConcept[] = result.data.concepts.slice(0, g.count).map((c) => (isVideo ? c : { ...c, beats: [] }));
      const rows = await createContentFromConcepts(ctx, product, concepts, {
        platform: g.platform,
        contentType: g.contentType,
        method: result.method,
        model: result.model,
        agentRunId: ctx.runId,
        scheduleFrom: input.schedule ? new Date(Date.now() + 86400_000) : null,
      });
      created += rows.length;
      summary.push({ platform: g.platform, contentType: g.contentType, count: rows.length, method: result.method });
    }
    ctx.step(`Created ${created} content items`);
    return { created, groups: summary };
  },
};

// ── Analytics Agent ─────────────────────────────────────────────────────────
export const analyticsAgent: AgentDef<Record<string, never>, unknown> = {
  name: "analytics",
  title: "Analytics Agent",
  description: "Rolls up daily product metrics and detects traffic and conversion spikes.",
  tier: "none",
  async run(ctx) {
    const synced = await syncProductMetrics(ctx, 2);
    const prefs = await getSetting(ctx, "notifications");
    const spikes = await detectSpikes(ctx, prefs.trafficSpikeMultiplier);
    for (const s of spikes) {
      await notify(ctx, {
        type: s.kind,
        severity: "success",
        title: `${s.kind === "TRAFFIC_SPIKE" ? "Traffic" : "Conversion"} spike: ${s.title}`,
        body: `${s.current} in the last 24h vs a ${round(s.baseline, 1)}/day baseline.`,
        entity: { type: "product", id: s.productId },
      });
    }
    ctx.step(`Synced ${synced.upserted} rollups, ${spikes.length} spikes`);
    return { ...synced, spikes };
  },
};

// ── Optimization Agent ──────────────────────────────────────────────────────
const AiRecs = z.object({
  recommendations: z.array(z.object({ productId: z.string().nullable(), title: z.string(), body: z.string(), priority: z.enum(["HIGH", "MEDIUM", "LOW"]) })),
});

export const optimizationAgent: AgentDef<Record<string, never>, unknown> = {
  name: "optimization",
  title: "Optimization Agent",
  description: "Evaluates running tests (WINNER / PROMISING / FAILURE → SCALE / TEST MORE / OPTIMIZE / CONTENT MORE / PAUSE / KILL) and produces metric-backed recommendations.",
  tier: "strong",
  async run(ctx) {
    const tests = await evaluateAllTests(ctx);
    const recs = await refreshRecommendations(ctx);
    // Optional AI layer: extra, specific recommendations grounded in the leaderboard numbers.
    const board = (await leaderboard(ctx, rangeForDays(14), 15)).filter((r) => r.views > 0);
    let aiCreated = 0;
    if (board.length >= 3) {
      const result = await aiStructured(ctx, {
        task: "recommendations",
        schema: AiRecs,
        schemaName: "recommendations",
        system: "You are FORGE's optimization strategist. Give at most 3 specific, actionable recommendations grounded ONLY in the metrics provided (cite the numbers). Never generic advice like 'keep it up'. Use the product ids given.",
        prompt: `14-day leaderboard (JSON):\n${JSON.stringify(board.map((r) => ({ productId: r.productId, title: r.title, status: r.status, score: r.score, views: r.views, affiliateClicks: r.affiliateClicks, conversions: r.conversions, ctr: round(r.ctr, 4), conversionRate: round(r.conversionRate, 4), revenue: r.revenue })))}`,
        fallback: () => ({ recommendations: [] }),
        agentRunId: ctx.runId,
      });
      if (result.method === "AI") {
        const ids = new Set(board.map((b) => b.productId));
        const drafts: RecommendationDraft[] = result.data.recommendations.slice(0, 3).map((r, i) => ({
          type: "AI_STRATEGY",
          fingerprint: `ai:${new Date().toISOString().slice(0, 10)}:${i}`,
          productId: r.productId && ids.has(r.productId) ? r.productId : null,
          priority: r.priority,
          title: r.title.slice(0, 200),
          body: r.body.slice(0, 1000),
          action: null,
          evidence: { model: result.model },
          source: "AI",
        }));
        aiCreated = await saveRecommendations(ctx, drafts);
      }
    }
    ctx.step(`Evaluated ${tests.evaluated} tests; ${recs.created} new rule recommendations; ${aiCreated} AI recommendations`);
    return { tests, recommendations: recs, aiCreated };
  },
};

// ── Reporting Agent ─────────────────────────────────────────────────────────
export const reportingAgent: AgentDef<{ type?: "TOP5_DAILY" | "TOP5_WEEKLY" }, { reportId: string; entries: number }> = {
  name: "reporting",
  title: "Reporting Agent",
  description: "Builds the daily/weekly Top 5 products-to-test report with evidence, economics, hooks, angles, risks and recommended actions.",
  tier: "strong",
  async run(ctx, input) {
    const report = await generateTop5Report(ctx, input.type ?? "TOP5_DAILY", async (productId) => {
      await runAgent(ctx, researchAgent, { productId }, { parentRunId: ctx.runId, productId });
    });
    const entries = (report.content.entries as unknown[]).length;
    ctx.step(`Report ${report.id} with ${entries} entries`);
    return { reportId: report.id, entries };
  },
};

export async function recentlyResearched(ctx: AgentContext, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await ctx.db.select({ id: productResearch.productId }).from(productResearch).where(inArray(productResearch.productId, ids));
  return new Set(rows.map((r) => r.id));
}
