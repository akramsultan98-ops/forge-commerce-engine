// AI Recommendation Engine (rules layer). Every recommendation is computed from actual metrics and
// carries its evidence. The Optimization agent may add AI-written ones on top (source = "AI").

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { formatPercent, round, safeDivide } from "@/lib/utils";
import type { Priority } from "@/lib/constants";
import type { ServiceContext } from "../context";
import { affiliateLinks, content, productTests, products, recommendations } from "../db/schema";
import { getSetting } from "../settings";
import { leaderboard, rangeForDays } from "./analytics";
import { contentPerformance } from "./content";
import { isDemoMode } from "../env";

export interface RecommendationDraft {
  type: string;
  fingerprint: string;
  productId?: string | null;
  priority: Priority;
  title: string;
  body: string;
  action?: { kind: string; label: string; params?: Record<string, unknown> } | null;
  evidence: Record<string, number | string>;
  source?: "RULES" | "AI";
}

export async function computeRecommendations(ctx: ServiceContext): Promise<RecommendationDraft[]> {
  const range = rangeForDays(14);
  const thresholds = await getSetting(ctx, "testing.thresholds");
  const board = await leaderboard(ctx, range, 200);
  const out: RecommendationDraft[] = [];
  const active = board.filter((r) => ["TESTING", "WINNER", "SCALING", "APPROVED"].includes(r.status));
  const withClicks = active.filter((r) => r.affiliateClicks + r.productClicks >= 20);
  const avgClicks = withClicks.length ? withClicks.reduce((s, r) => s + r.affiliateClicks + r.productClicks, 0) / withClicks.length : 0;

  for (const r of withClicks) {
    const clicks = r.affiliateClicks + r.productClicks;
    const ratio = safeDivide(clicks, avgClicks);
    if (withClicks.length >= 3 && ratio >= 2) {
      out.push({
        type: "CLICK_OUTPERFORMER",
        fingerprint: `click-outperformer:${r.productId}`,
        productId: r.productId,
        priority: "HIGH",
        title: `${r.title} is out-pulling the portfolio`,
        body: `${r.title} is receiving ${round(ratio, 1)}× more clicks than the portfolio average (${clicks} vs ${Math.round(avgClicks)} in 14 days). Generate more short-form content.`,
        action: { kind: "GENERATE_CONTENT", label: "Generate 10 more concepts", params: { productId: r.productId, count: 10 } },
        evidence: { clicks, portfolioAverage: round(avgClicks, 1), ratio: round(ratio, 2) },
      });
    }
    if (r.views >= thresholds.minPageViews && r.ctr >= thresholds.winner.minAffiliateCtr && r.conversionRate < thresholds.winner.minConversionRate) {
      out.push({
        type: "CTR_HIGH_CONVERSION_LOW",
        fingerprint: `ctr-high-conv-low:${r.productId}`,
        productId: r.productId,
        priority: "HIGH",
        title: `${r.title}: strong clicks, weak conversion`,
        body: `${r.title} has strong CTR (${formatPercent(r.ctr)}) but weak conversion (${formatPercent(r.conversionRate, 2)}). Test a shorter hero section and move the demonstration video above the fold.`,
        action: { kind: "CREATE_EXPERIMENT", label: "Start a hero A/B test", params: { productId: r.productId, type: "STRUCTURE" } },
        evidence: { views: r.views, ctr: round(r.ctr * 100, 2), conversionRate: round(r.conversionRate * 100, 2) },
      });
    }
  }

  // Performance drop: week-over-week traffic decline on live products.
  const drops = await ctx.db.execute(sql`
    select p.id, p.title,
      (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'PAGE_VIEW' and e.is_bot = false and e.created_at >= now() - interval '7 days')::int as recent,
      (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'PAGE_VIEW' and e.is_bot = false and e.created_at >= now() - interval '14 days' and e.created_at < now() - interval '7 days')::int as prior
    from products p where p.organization_id = ${ctx.orgId} and p.status in ('TESTING','WINNER','SCALING')`);
  for (const r of drops.rows as Array<{ id: string; title: string; recent: number; prior: number }>) {
    const recent = Number(r.recent);
    const prior = Number(r.prior);
    if (prior >= 100 && recent < prior * 0.6) {
      out.push({
        type: "PERFORMANCE_DROP",
        fingerprint: `performance-drop:${r.id}`,
        productId: r.id,
        priority: "HIGH",
        title: `Traffic to ${r.title} is falling`,
        body: `Page views fell ${Math.round((1 - recent / prior) * 100)}% week-over-week (${recent} vs ${prior}). Refresh the content with a new hook and re-check the landing page's first screen before the test window closes.`,
        action: { kind: "GENERATE_CONTENT", label: "Generate 5 fresh hooks", params: { productId: r.id, count: 5 } },
        evidence: { views7d: recent, viewsPrior7d: prior },
      });
    }
  }

  // Winning hook → more of the same.
  const perf = await contentPerformance(ctx, { since: range.from, includeDemo: isDemoMode() });
  const scored = perf.filter((p) => p.views >= 300 || p.siteVisits >= 30);
  const avgCtr = scored.length ? scored.reduce((s, p) => s + p.ctr, 0) / scored.length : 0;
  const topHook = [...scored].sort((a, b) => b.ctr - a.ctr)[0];
  if (topHook && scored.length >= 3 && topHook.ctr >= 1.5 * avgCtr && topHook.hook) {
    out.push({
      type: "WINNING_HOOK",
      fingerprint: `winning-hook:${topHook.id}`,
      productId: topHook.productId,
      priority: "HIGH",
      title: "A hook is clearly winning",
      body: `“${topHook.hook}” (${topHook.platform.toLowerCase()}, ${topHook.angle?.toLowerCase().replace(/_/g, " ") ?? "—"}) drives ${round(safeDivide(topHook.ctr, avgCtr), 1)}× the average click-through. Create 5 more videos using this hook.`,
      action: { kind: "GENERATE_CONTENT", label: "Create 5 variations", params: { productId: topHook.productId, count: 5, angle: topHook.angle, platform: topHook.platform } },
      evidence: { contentCtr: round(topHook.ctr * 100, 2), averageCtr: round(avgCtr * 100, 2), views: topHook.views },
    });
  }
  // High engagement but low traffic → distribution problem.
  for (const p of perf.filter((x) => x.views >= 500 && x.engagementRate >= thresholds.engagement.strongRate && x.siteVisits < 20).slice(0, 3)) {
    out.push({
      type: "ENGAGEMENT_NO_TRAFFIC",
      fingerprint: `engagement-no-traffic:${p.id}`,
      productId: p.productId,
      priority: "MEDIUM",
      title: `Great engagement, few visits: ${p.title}`,
      body: `This ${p.platform.toLowerCase()} post has ${formatPercent(p.engagementRate)} engagement but sent only ${p.siteVisits} visits. Add a clearer spoken CTA and pin the tracked link.`,
      action: null,
      evidence: { views: p.views, engagementRate: round(p.engagementRate * 100, 2), visits: p.siteVisits },
    });
  }

  // Broken links still receiving traffic.
  const broken = await ctx.db
    .select({ id: affiliateLinks.id, productId: affiliateLinks.productId, url: affiliateLinks.url, title: products.title })
    .from(affiliateLinks)
    .leftJoin(products, eq(products.id, affiliateLinks.productId))
    .where(and(eq(affiliateLinks.organizationId, ctx.orgId), eq(affiliateLinks.status, "BROKEN")));
  for (const b of broken) {
    out.push({
      type: "BROKEN_LINK",
      fingerprint: `broken-link:${b.id}`,
      productId: b.productId,
      priority: "HIGH",
      title: `Fix the affiliate link for ${b.title ?? "a product"}`,
      body: `The primary link (${b.url}) failed its last check. Visitors are being routed to the product page instead of the merchant — replace or re-check the link.`,
      action: { kind: "OPEN_LINKS", label: "Open link manager", params: { productId: b.productId } },
      evidence: { linkId: b.id },
    });
  }

  // High-scoring products with no content yet → launch kit.
  const noContent = await ctx.db.execute(sql`
    select p.id, p.title, p.overall_score as score from products p
    where p.organization_id = ${ctx.orgId} and p.status in ('DISCOVERED','RESEARCHING','APPROVED') and p.overall_score >= 70
      and ${isDemoMode() ? sql`true` : sql`p.is_demo = false`}
      and not exists (select 1 from content c where c.product_id = p.id)
    order by p.overall_score desc limit 3`);
  for (const r of noContent.rows as Array<{ id: string; title: string; score: number }>) {
    out.push({
      type: "LAUNCH_HIGH_SCORE",
      fingerprint: `launch-high-score:${r.id}`,
      productId: r.id,
      priority: "MEDIUM",
      title: `${r.title} scores ${round(Number(r.score))} but has no content`,
      body: `Generate a launch kit (research, landing page, 10 short-form concepts, tracked links) and start a 14-day test.`,
      action: { kind: "LAUNCH_TEST", label: "Generate launch kit", params: { productId: r.id } },
      evidence: { score: round(Number(r.score)) },
    });
  }

  // Tests running past their planned window.
  const overdue = await ctx.db
    .select({ id: productTests.id, productId: productTests.productId, startedAt: productTests.startedAt, plannedDays: productTests.plannedDays, title: products.title })
    .from(productTests)
    .innerJoin(products, eq(products.id, productTests.productId))
    .where(and(eq(productTests.organizationId, ctx.orgId), eq(productTests.status, "RUNNING")));
  for (const t of overdue) {
    const days = Math.floor((Date.now() - t.startedAt.getTime()) / 86400_000);
    if (days > t.plannedDays) {
      out.push({
        type: "TEST_OVERDUE",
        fingerprint: `test-overdue:${t.id}`,
        productId: t.productId,
        priority: "MEDIUM",
        title: `Close the test for ${t.title}`,
        body: `The test has run ${days} days (planned ${t.plannedDays}). Evaluate it and decide: scale, optimize or kill.`,
        action: { kind: "EVALUATE_TEST", label: "Evaluate now", params: { testId: t.id } },
        evidence: { days, plannedDays: t.plannedDays },
      });
    }
  }
  return out;
}

export async function saveRecommendations(ctx: ServiceContext, drafts: RecommendationDraft[]) {
  let created = 0;
  for (const d of drafts) {
    const res = await ctx.db
      .insert(recommendations)
      .values({ organizationId: ctx.orgId, productId: d.productId ?? null, type: d.type, fingerprint: d.fingerprint, priority: d.priority, title: d.title, body: d.body, action: d.action ?? null, evidence: d.evidence, source: d.source ?? "RULES" })
      .onConflictDoNothing()
      .returning({ id: recommendations.id });
    created += res.length;
  }
  return created;
}

export async function refreshRecommendations(ctx: ServiceContext) {
  const drafts = await computeRecommendations(ctx);
  const created = await saveRecommendations(ctx, drafts);
  return { computed: drafts.length, created };
}

export async function listRecommendations(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { status?: "OPEN" | "DONE" | "DISMISSED"; productId?: string; limit?: number } = {}) {
  return ctx.db
    .select({ rec: recommendations, productTitle: products.title })
    .from(recommendations)
    .leftJoin(products, eq(products.id, recommendations.productId))
    .where(and(eq(recommendations.organizationId, ctx.orgId), eq(recommendations.status, opts.status ?? "OPEN"), opts.productId ? eq(recommendations.productId, opts.productId) : undefined))
    .orderBy(sql`case ${recommendations.priority} when 'HIGH' then 0 when 'MEDIUM' then 1 else 2 end`, desc(recommendations.createdAt))
    .limit(opts.limit ?? 20);
}

export async function resolveRecommendation(ctx: ServiceContext, id: string, status: "DONE" | "DISMISSED") {
  await ctx.db.update(recommendations).set({ status, resolvedAt: new Date() }).where(and(eq(recommendations.id, id), eq(recommendations.organizationId, ctx.orgId)));
}

export async function contentCount(ctx: Pick<ServiceContext, "db">, productIds: string[]) {
  if (!productIds.length) return new Map<string, number>();
  const res = await ctx.db.select({ productId: content.productId, n: sql<number>`count(*)::int` }).from(content).where(inArray(content.productId, productIds)).groupBy(content.productId);
  return new Map(res.map((r) => [r.productId ?? "", Number(r.n)]));
}
