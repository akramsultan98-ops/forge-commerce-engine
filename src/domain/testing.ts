// Product Testing Engine + Kill/Scale Decision Engine — pure functions with configurable thresholds.

import type { BusinessModel, Decision, TestVerdict } from "@/lib/constants";
import { round, safeDivide } from "@/lib/utils";

export interface TestThresholds {
  minDays: number;
  maxDays: number;
  minPageViews: number;
  winner: { minAffiliateCtr: number; minConversionRate: number; minRoi: number };
  failure: { maxAffiliateCtr: number; maxConversionRate: number };
  engagement: { strongRate: number };
}

export const DEFAULT_TEST_THRESHOLDS: TestThresholds = {
  minDays: 7,
  maxDays: 14,
  minPageViews: 300,
  winner: { minAffiliateCtr: 0.08, minConversionRate: 0.015, minRoi: 0.2 },
  failure: { maxAffiliateCtr: 0.025, maxConversionRate: 0.004 },
  engagement: { strongRate: 0.05 },
};

export interface TestMetrics {
  days: number;
  pageViews: number;
  productClicks: number;
  affiliateClicks: number;
  conversions: number;
  revenue: number;
  commission: number;
  /** Costs attributable to the test: ad spend, COGS + shipping for owned-inventory models. */
  cost: number;
  contentViews: number;
  contentEngagements: number;
}

export interface DerivedMetrics {
  affiliateCtr: number;
  conversionRate: number;
  clickToConversion: number;
  earnings: number;
  profit: number;
  roi: number | null;
  engagementRate: number;
}

export function deriveMetrics(m: TestMetrics, model: BusinessModel): DerivedMetrics {
  // What FORGE actually earns: commission for affiliate, revenue for owned-inventory models.
  const earnings = model === "AFFILIATE" ? m.commission : m.revenue;
  const profit = earnings - m.cost;
  return {
    affiliateCtr: safeDivide(model === "AFFILIATE" ? m.affiliateClicks : m.productClicks || m.affiliateClicks, m.pageViews),
    conversionRate: safeDivide(m.conversions, m.pageViews),
    clickToConversion: safeDivide(m.conversions, m.affiliateClicks || m.productClicks),
    earnings,
    profit,
    roi: m.cost > 0 ? profit / m.cost : null,
    engagementRate: safeDivide(m.contentEngagements, m.contentViews),
  };
}

const pct = (n: number) => `${round(n * 100, 2)}%`;

function economicsPositive(d: DerivedMetrics, t: TestThresholds): boolean {
  return d.roi === null ? d.profit > 0 : d.roi >= t.winner.minRoi;
}

export function classifyTest(
  m: TestMetrics,
  model: BusinessModel,
  t: TestThresholds = DEFAULT_TEST_THRESHOLDS,
): { verdict: TestVerdict; reasons: string[]; derived: DerivedMetrics } {
  const d = deriveMetrics(m, model);
  const reasons: string[] = [];
  const enoughTraffic = m.pageViews >= t.minPageViews;
  const windowOver = m.days >= t.maxDays;

  if (!enoughTraffic && !windowOver) {
    reasons.push(`Only ${m.pageViews} of ${t.minPageViews} required page views after ${m.days} day(s)`);
    return { verdict: "INSUFFICIENT_DATA", reasons, derived: d };
  }

  const ctrStrong = d.affiliateCtr >= t.winner.minAffiliateCtr;
  const convStrong = d.conversionRate >= t.winner.minConversionRate;
  const econ = economicsPositive(d, t);

  if (enoughTraffic && ctrStrong && convStrong && econ) {
    reasons.push(`Click-through ${pct(d.affiliateCtr)} ≥ ${pct(t.winner.minAffiliateCtr)}`);
    reasons.push(`Conversion ${pct(d.conversionRate)} ≥ ${pct(t.winner.minConversionRate)}`);
    reasons.push(d.roi === null ? `Positive earnings (${round(d.profit, 2)}) with no paid spend` : `ROI ${pct(d.roi)} ≥ ${pct(t.winner.minRoi)}`);
    return { verdict: "WINNER", reasons, derived: d };
  }

  const ctrWeak = d.affiliateCtr <= t.failure.maxAffiliateCtr;
  const convWeak = d.conversionRate <= t.failure.maxConversionRate;
  const engagementStrong = d.engagementRate >= t.engagement.strongRate;

  if (enoughTraffic && ctrWeak && convWeak) {
    reasons.push(`Click-through ${pct(d.affiliateCtr)} ≤ ${pct(t.failure.maxAffiliateCtr)}`);
    reasons.push(`Conversion ${pct(d.conversionRate)} ≤ ${pct(t.failure.maxConversionRate)}`);
    if (!econ) reasons.push("Economics negative");
    return { verdict: "FAILURE", reasons, derived: d };
  }

  if (!enoughTraffic && windowOver) {
    if (engagementStrong) {
      reasons.push(`Content engagement ${pct(d.engagementRate)} is strong, but only ${m.pageViews} page views in ${m.days} days`);
      return { verdict: "PROMISING", reasons, derived: d };
    }
    reasons.push(`Test window over with only ${m.pageViews} page views and weak engagement — insufficient demand`);
    return { verdict: "FAILURE", reasons, derived: d };
  }

  if (windowOver && !econ && !ctrStrong) {
    reasons.push(`Full ${t.maxDays}-day window elapsed without strong click-through or positive economics`);
    return { verdict: "FAILURE", reasons, derived: d };
  }

  if (ctrStrong) reasons.push(`Strong click-through ${pct(d.affiliateCtr)}`);
  if (!convStrong) reasons.push(`Conversion ${pct(d.conversionRate)} below winner threshold ${pct(t.winner.minConversionRate)}`);
  if (!econ) reasons.push("Economics not yet positive");
  if (engagementStrong) reasons.push(`Engagement rate ${pct(d.engagementRate)}`);
  return { verdict: "PROMISING", reasons, derived: d };
}

export interface DecisionContext {
  verdict: TestVerdict;
  metrics: TestMetrics;
  model: BusinessModel;
  thresholds?: TestThresholds;
  available?: boolean;
  linkBroken?: boolean;
}

/** SCALE / TEST_MORE / OPTIMIZE / CONTENT_MORE / PAUSE / KILL with human-readable reasons. */
export function decide(ctx: DecisionContext): { decision: Decision; reasons: string[] } {
  const t = ctx.thresholds ?? DEFAULT_TEST_THRESHOLDS;
  const d = deriveMetrics(ctx.metrics, ctx.model);
  const m = ctx.metrics;
  if (ctx.available === false) return { decision: "PAUSE", reasons: ["Product is unavailable at the supplier/merchant"] };
  if (ctx.linkBroken) return { decision: "PAUSE", reasons: ["Primary affiliate link is broken — fix it before sending more traffic"] };

  const trafficOk = m.pageViews >= t.minPageViews;
  const ctrOk = d.affiliateCtr >= t.winner.minAffiliateCtr * 0.75;
  const convPoor = d.conversionRate < t.winner.minConversionRate;
  const engagementStrong = d.engagementRate >= t.engagement.strongRate;

  switch (ctx.verdict) {
    case "WINNER":
      return {
        decision: "SCALE",
        reasons: [
          "Test classified as WINNER",
          `Conversion ${pct(d.conversionRate)} with ${d.roi === null ? "positive organic earnings" : `ROI ${pct(d.roi)}`}`,
          "Increase content output and traffic",
        ],
      };
    case "INSUFFICIENT_DATA":
      if (engagementStrong) return { decision: "CONTENT_MORE", reasons: [`Engagement ${pct(d.engagementRate)} is strong but traffic is low — publish more content`] };
      return { decision: "TEST_MORE", reasons: [`Needs ${Math.max(0, t.minPageViews - m.pageViews)} more page views before a verdict`] };
    case "FAILURE":
      if (trafficOk && ctrOk && convPoor) return { decision: "OPTIMIZE", reasons: ["Good traffic and click-through but poor conversion — fix the offer/page before killing"] };
      if (!trafficOk && engagementStrong) return { decision: "CONTENT_MORE", reasons: ["High engagement but low traffic — distribution problem, not product problem"] };
      return { decision: "KILL", reasons: ["Low demand, low engagement and poor conversion", ...classifyTest(m, ctx.model, t).reasons] };
    case "PROMISING":
    default:
      if (trafficOk && ctrOk && convPoor) return { decision: "OPTIMIZE", reasons: ["Good traffic but poor conversion — test page structure, hero and CTA"] };
      if (!trafficOk && engagementStrong) return { decision: "CONTENT_MORE", reasons: ["High engagement + low traffic — create more content on the winning hook"] };
      return { decision: "TEST_MORE", reasons: ["Promising but not yet conclusive — keep the test running"] };
  }
}
