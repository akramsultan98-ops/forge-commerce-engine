// FORGE Product Scoring Engine — pure, deterministic, explainable.
// Every factor produces a 0–100 subscore, a provenance (how trustworthy its inputs are) and a note.
// The overall score is the weighted mean of subscores; confidence is the weighted mean of input quality.

import type { BusinessModel, Provenance, RiskLevel } from "@/lib/constants";
import { clamp, round } from "@/lib/utils";

export const ENGINE_VERSION = "score-v1.0";

export const SCORING_FACTORS = ["trend", "velocity", "margin", "content", "problem", "impulse", "competition", "novelty", "shipping"] as const;
export type ScoringFactor = (typeof SCORING_FACTORS)[number];
export type ScoringWeights = Record<ScoringFactor, number>;

export const DEFAULT_WEIGHTS: ScoringWeights = {
  trend: 15,
  velocity: 15,
  margin: 15,
  content: 15,
  problem: 10,
  impulse: 10,
  competition: 10,
  novelty: 5,
  shipping: 5,
};

export const FACTOR_META: Record<ScoringFactor, { label: string; description: string }> = {
  trend: { label: "Trend potential", description: "Growth of search / social / interest signals" },
  velocity: { label: "Sales velocity", description: "Estimated units sold and review growth" },
  margin: { label: "Margin potential", description: "Gross margin (dropshipping) or commission economics (affiliate)" },
  content: { label: "Content potential", description: "How well the product demonstrates in short-form video" },
  problem: { label: "Problem–solution strength", description: "How obvious and painful the solved problem is" },
  impulse: { label: "Impulse-buy potential", description: "Price point and instant-gratification appeal" },
  competition: { label: "Competition opportunity", description: "Inverse of seller density and ad saturation" },
  novelty: { label: "Novelty", description: "How new the product feels to the average buyer" },
  shipping: { label: "Shipping feasibility", description: "Delivery time, shipping cost and market availability" },
};

export type InputProvenance = Provenance | "MISSING";
export const PROVENANCE_QUALITY: Record<InputProvenance, number> = {
  REAL: 1,
  MANUAL: 0.85,
  ESTIMATED: 0.65,
  AI_INFERENCE: 0.5,
  DEMO: 0.35,
  MISSING: 0,
};

export interface ScoringInput {
  title: string;
  description?: string | null;
  categorySlug?: string | null;
  tags?: string[];
  businessModel: BusinessModel;
  currency: string;
  /** Selling price converted to USD for price-band heuristics (defaults to sellingPrice). */
  priceUsd?: number | null;
  cost?: number | null;
  sellingPrice?: number | null;
  shippingCost?: number | null;
  affiliateCommission?: number | null;
  commissionPercentage?: number | null;
  shippingDaysMin?: number | null;
  shippingDaysMax?: number | null;
  countriesAvailable?: string[];
  targetCountries?: string[];
  rating?: number | null;
  reviewCount?: number | null;
  reviewGrowth?: number | null;
  estimatedSales?: number | null;
  salesVelocity?: number | null;
  sellerCount?: number | null;
  adActivity?: number | null;
  trendScore?: number | null;
  competitionScore?: number | null;
  contentScore?: number | null;
  impulseScore?: number | null;
  problemScore?: number | null;
  noveltyScore?: number | null;
  saturationScore?: number | null;
  marginScore?: number | null;
  /** Provenance per input field name (e.g. { cost: "REAL", trendScore: "AI_INFERENCE" }). */
  provenance?: Record<string, Provenance | undefined>;
}

export interface FactorResult {
  factor: ScoringFactor;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  provenance: InputProvenance;
  note: string;
}

export interface ScoreResult {
  overall: number;
  confidence: number;
  factors: Record<ScoringFactor, FactorResult>;
  reasons: string[];
  warnings: string[];
  riskLevel: RiskLevel;
  riskFlags: string[];
  weights: ScoringWeights;
  engineVersion: string;
}

type FactorPartial = { score: number; provenance: InputProvenance; note: string };

const has = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Linear interpolation across sorted [x, y] control points, clamped at both ends. */
export function piecewise(x: number, points: Array<[number, number]>): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return points[points.length - 1][1];
}

function prov(input: ScoringInput, field: string): Provenance {
  return input.provenance?.[field] ?? "ESTIMATED";
}

function worst(...ps: InputProvenance[]): InputProvenance {
  return ps.reduce((a, b) => (PROVENANCE_QUALITY[b] < PROVENANCE_QUALITY[a] ? b : a));
}

const money = (n: number, currency: string) => `${currency === "USD" ? "$" : ""}${round(n, 2)}${currency === "USD" ? "" : ` ${currency}`}`;

function trendFactor(i: ScoringInput): FactorPartial {
  if (has(i.trendScore)) return { score: clamp(i.trendScore), provenance: prov(i, "trendScore"), note: `Trend index ${round(i.trendScore)}` };
  if (has(i.reviewGrowth)) {
    const s = piecewise(i.reviewGrowth, [[-20, 10], [0, 30], [10, 55], [30, 80], [60, 95]]);
    return { score: s, provenance: worst(prov(i, "reviewGrowth"), "ESTIMATED"), note: `Derived from ${round(i.reviewGrowth)}% review growth` };
  }
  return { score: 50, provenance: "MISSING", note: "No trend data — held at neutral" };
}

function velocityFactor(i: ScoringInput): FactorPartial {
  const logScore = (x: number) => clamp(piecewise(Math.log10(Math.max(1, x)), [[1, 20], [2, 45], [3, 70], [4, 90], [5, 100]]));
  if (has(i.estimatedSales)) return { score: logScore(i.estimatedSales), provenance: prov(i, "estimatedSales"), note: `~${i.estimatedSales} units/month` };
  if (has(i.salesVelocity)) return { score: logScore(i.salesVelocity * 30), provenance: prov(i, "salesVelocity"), note: `~${round(i.salesVelocity)} units/day` };
  if (has(i.reviewCount) && has(i.reviewGrowth)) {
    // Rough proxy: ~2% of buyers leave a review. Monthly new reviews ≈ reviewCount × growth%.
    const monthlyReviews = (i.reviewCount * Math.max(0, i.reviewGrowth)) / 100;
    return { score: logScore(monthlyReviews * 50), provenance: "ESTIMATED", note: "Estimated from review growth (≈2% review rate)" };
  }
  return { score: 50, provenance: "MISSING", note: "No sales velocity data — held at neutral" };
}

function marginFactor(i: ScoringInput): FactorPartial & { marginPct?: number; unitProfit?: number; commission?: number } {
  const price = i.sellingPrice;
  if (i.businessModel === "AFFILIATE") {
    let commission: number | null = null;
    let pct: number | null = null;
    if (has(i.affiliateCommission)) commission = i.affiliateCommission;
    if (has(i.commissionPercentage)) {
      pct = i.commissionPercentage;
      if (commission === null && has(price)) commission = (price * pct) / 100;
    }
    if (pct === null && commission !== null && has(price) && price > 0) pct = (commission / price) * 100;
    if (pct === null && commission === null) {
      if (has(i.marginScore)) return { score: clamp(i.marginScore), provenance: prov(i, "marginScore"), note: "Operator margin estimate" };
      return { score: 50, provenance: "MISSING", note: "No commission data — held at neutral" };
    }
    let s = pct !== null ? piecewise(pct, [[1, 10], [4, 35], [8, 60], [15, 85], [25, 100]]) : 50;
    if (commission !== null) {
      if (commission >= 10) s += 10;
      else if (commission < 1) s -= 15;
    }
    const p = worst(prov(i, has(i.commissionPercentage) ? "commissionPercentage" : "affiliateCommission"), has(price) ? prov(i, "sellingPrice") : "ESTIMATED");
    const note = `${pct !== null ? `${round(pct)}% commission` : "Flat commission"}${commission !== null ? ` ≈ ${money(commission, i.currency)}/sale` : ""}`;
    return { score: clamp(s), provenance: p, note, commission: commission ?? undefined, marginPct: pct ?? undefined };
  }
  if (!has(price) || !has(i.cost) || price <= 0) {
    if (has(i.marginScore)) return { score: clamp(i.marginScore), provenance: prov(i, "marginScore"), note: "Operator margin estimate" };
    return { score: 50, provenance: "MISSING", note: "Missing cost or price — held at neutral" };
  }
  const shipping = has(i.shippingCost) ? i.shippingCost : 0;
  const unitProfit = price - i.cost - shipping;
  const marginPct = (unitProfit / price) * 100;
  let s = piecewise(marginPct, [[0, 0], [15, 20], [30, 50], [50, 80], [65, 100]]);
  if (unitProfit < 8) s -= 10; // thin absolute profit leaves no room for ad spend
  const p = worst(prov(i, "cost"), prov(i, "sellingPrice"));
  return { score: clamp(s), provenance: p, note: `${round(marginPct)}% gross margin, ${money(unitProfit, i.currency)}/unit`, marginPct, unitProfit };
}

function impulseFactor(i: ScoringInput): FactorPartial {
  const price = has(i.priceUsd) ? i.priceUsd : i.sellingPrice;
  const band = has(price) ? piecewise(price, [[15, 92], [25, 88], [40, 78], [60, 60], [100, 40], [150, 18], [300, 8]]) : null;
  if (has(i.impulseScore) && band !== null) {
    return { score: clamp(0.6 * i.impulseScore + 0.4 * band), provenance: prov(i, "impulseScore"), note: `Impulse appeal ${round(i.impulseScore)}, price band ${round(band)}` };
  }
  if (has(i.impulseScore)) return { score: clamp(i.impulseScore), provenance: prov(i, "impulseScore"), note: "Impulse appeal estimate" };
  if (band !== null) return { score: band, provenance: worst(prov(i, "sellingPrice"), "ESTIMATED"), note: `Price-band heuristic (${money(price as number, "USD")})` };
  return { score: 50, provenance: "MISSING", note: "No price data — held at neutral" };
}

function competitionFactor(i: ScoringInput): FactorPartial {
  let base: number | null = null;
  let p: InputProvenance = "MISSING";
  let note = "";
  if (has(i.competitionScore)) {
    base = 100 - clamp(i.competitionScore);
    p = prov(i, "competitionScore");
    note = `Competition ${round(i.competitionScore)}/100`;
  } else if (has(i.sellerCount)) {
    base = piecewise(i.sellerCount, [[5, 85], [20, 60], [100, 30], [500, 10]]);
    p = prov(i, "sellerCount");
    note = `${i.sellerCount} sellers`;
  }
  if (base === null) return { score: 50, provenance: "MISSING", note: "No competition data — held at neutral" };
  if (has(i.saturationScore)) {
    base = 0.7 * base + 0.3 * (100 - clamp(i.saturationScore));
    note += `, ad saturation ${round(i.saturationScore)}`;
  }
  if (has(i.adActivity) && i.adActivity > 70) base -= 5;
  return { score: clamp(base), provenance: p, note };
}

function shippingFactor(i: ScoringInput): FactorPartial {
  const targets = i.targetCountries ?? [];
  const available = i.countriesAvailable ?? [];
  if (targets.length && available.length && !targets.some((c) => available.includes(c))) {
    return { score: 10, provenance: prov(i, "countriesAvailable"), note: "Not available in the target market" };
  }
  if (!has(i.shippingDaysMax) && !has(i.shippingDaysMin)) {
    if (i.businessModel === "AFFILIATE") return { score: 80, provenance: "ESTIMATED", note: "Merchant handles fulfilment" };
    return { score: 50, provenance: "MISSING", note: "No shipping data — held at neutral" };
  }
  const days = has(i.shippingDaysMax) ? i.shippingDaysMax : (i.shippingDaysMin as number);
  let s = piecewise(days, [[3, 100], [5, 95], [8, 82], [12, 65], [18, 45], [25, 25], [35, 10]]);
  if (has(i.shippingCost) && has(i.sellingPrice) && i.sellingPrice > 0 && i.shippingCost / i.sellingPrice > 0.25) s -= 20;
  return { score: clamp(s), provenance: prov(i, has(i.shippingDaysMax) ? "shippingDaysMax" : "shippingDaysMin"), note: `Delivery up to ${days} days` };
}

function inputFactor(i: ScoringInput, field: keyof ScoringInput, missingNote: string, label: string): FactorPartial {
  const v = i[field];
  if (has(v as number)) return { score: clamp(v as number), provenance: prov(i, field as string), note: `${label} ${round(v as number)}` };
  return { score: 50, provenance: "MISSING", note: missingNote };
}

// ── Risk assessment (Section 54: avoid legal / medical / safety / IP / regulatory risk) ──
const RISK_RULES: Array<{ pattern: RegExp; flag: string; level: RiskLevel }> = [
  { pattern: /\b(cure|treat(s|ment)?|heal(s|ing)?|medical|diagnos|pain relief|arthritis|diabet|blood pressure|posture correct)/i, flag: "Medical or health claims — regulated advertising", level: "HIGH" },
  { pattern: /\b(supplement|vitamin|weight ?loss|fat burn|detox|keto pill|cbd|thc|nicotine|vape|kratom)\b/i, flag: "Ingestible / regulated substance", level: "HIGH" },
  { pattern: /\b(knife|knives|blade|taser|stun gun|pepper spray|weapon|firearm|gun|ammo|crossbow|firework)\b/i, flag: "Weapon or dangerous item", level: "HIGH" },
  { pattern: /\b(replica|dupe|knock-?off|inspired by (chanel|dior|gucci|nike|apple))\b/i, flag: "Counterfeit / trademark risk", level: "HIGH" },
  { pattern: /\b(disney|marvel|pok[eé]mon|star wars|harry potter|nintendo|barbie|hello kitty)\b/i, flag: "Licensed IP / copyright risk", level: "HIGH" },
  { pattern: /\b(baby|infant|newborn|toddler|crib|pacifier|teether)\b/i, flag: "Children's product — safety certification (e.g. CPSIA/CE)", level: "MEDIUM" },
  { pattern: /\b(charger|plug-?in|mains|110v|220v|heater|space heater|lithium|power bank)\b/i, flag: "Electrical — certification (UL/CE/FCC) and battery shipping rules", level: "MEDIUM" },
  { pattern: /\b(serum|cream|skincare|skin care|cosmetic|teeth whitening|hair growth)\b/i, flag: "Cosmetic — ingredient and claim compliance", level: "MEDIUM" },
  { pattern: /\b(aerosol|flammable|liquid|perfume|nail polish)\b/i, flag: "Shipping restrictions (liquids/aerosols/flammables)", level: "MEDIUM" },
  { pattern: /\b(glass|ceramic|fragile)\b/i, flag: "Fragile — higher breakage and return complexity", level: "LOW" },
];

export function assessRisk(text: string): { level: RiskLevel; flags: string[] } {
  const flags: string[] = [];
  let level: RiskLevel = "LOW";
  const rank: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(text)) {
      flags.push(rule.flag);
      if (rank[rule.level] > rank[level]) level = rule.level;
    }
  }
  return { level, flags };
}

export function normalizeWeights(weights: Partial<ScoringWeights> | undefined): ScoringWeights {
  const out = { ...DEFAULT_WEIGHTS };
  if (weights) {
    for (const f of SCORING_FACTORS) {
      const w = weights[f];
      if (typeof w === "number" && Number.isFinite(w) && w >= 0) out[f] = w;
    }
  }
  const total = SCORING_FACTORS.reduce((s, f) => s + out[f], 0);
  if (total <= 0) return { ...DEFAULT_WEIGHTS };
  return out;
}

const STRENGTH: Record<ScoringFactor, (r: FactorResult, extra: Record<string, number | undefined>) => string> = {
  trend: (r) => (r.score >= 85 ? "Strong trend growth" : "Positive trend momentum"),
  velocity: () => "High sales velocity",
  margin: (_r, x) =>
    x.commission !== undefined
      ? `Healthy commission economics${x.marginPct !== undefined ? ` (${round(x.marginPct)}%)` : ""}`
      : `Good estimated margin${x.marginPct !== undefined ? ` (${round(x.marginPct)}%)` : ""}`,
  content: () => "High visual demonstration potential",
  problem: () => "Strong problem/solution relationship",
  impulse: () => "Impulse-friendly price point",
  competition: () => "Low competition",
  novelty: () => "Feels new to most buyers",
  shipping: () => "Low shipping complexity",
};

const WEAKNESS: Record<ScoringFactor, (r: FactorResult, extra: Record<string, number | undefined>) => string> = {
  trend: () => "Weak or declining trend signal",
  velocity: () => "Low sales velocity",
  margin: (_r, x) => (x.marginPct !== undefined ? `Thin margin (${round(x.marginPct)}%)` : "Weak unit economics"),
  content: () => "Hard to demonstrate on video",
  problem: () => "Weak problem/solution link",
  impulse: () => "Price point limits impulse purchases",
  competition: () => "Crowded market",
  novelty: () => "Low novelty — buyers have seen it before",
  shipping: (r) => `Shipping is a constraint (${r.note.toLowerCase()})`,
};

export function scoreProduct(input: ScoringInput, weightsIn?: Partial<ScoringWeights>): ScoreResult {
  const weights = normalizeWeights(weightsIn);
  const margin = marginFactor(input);
  const partials: Record<ScoringFactor, FactorPartial> = {
    trend: trendFactor(input),
    velocity: velocityFactor(input),
    margin,
    content: inputFactor(input, "contentScore", "No content assessment — held at neutral", "Content potential"),
    problem: inputFactor(input, "problemScore", "No problem/solution assessment — held at neutral", "Problem strength"),
    impulse: impulseFactor(input),
    competition: competitionFactor(input),
    novelty: inputFactor(input, "noveltyScore", "No novelty assessment — held at neutral", "Novelty"),
    shipping: shippingFactor(input),
  };

  const totalWeight = SCORING_FACTORS.reduce((s, f) => s + weights[f], 0);
  const factors = {} as Record<ScoringFactor, FactorResult>;
  let weighted = 0;
  let quality = 0;
  for (const f of SCORING_FACTORS) {
    const p = partials[f];
    const w = weights[f];
    const contribution = (p.score * w) / totalWeight;
    weighted += contribution;
    quality += (PROVENANCE_QUALITY[p.provenance] * w) / totalWeight;
    factors[f] = { factor: f, label: FACTOR_META[f].label, score: round(p.score), weight: w, contribution: round(contribution, 2), provenance: p.provenance, note: p.note };
  }

  const extra = { marginPct: margin.marginPct, commission: margin.commission };
  const ranked = SCORING_FACTORS.filter((f) => weights[f] > 0).sort((a, b) => factors[b].contribution - factors[a].contribution);
  const reasons = ranked.filter((f) => factors[f].score >= 75 && factors[f].provenance !== "MISSING").map((f) => STRENGTH[f](factors[f], extra));
  const warnings: string[] = [];
  for (const f of ranked) {
    const r = factors[f];
    if (r.provenance === "MISSING") continue;
    if (r.score <= 40) warnings.push(WEAKNESS[f](r, extra));
  }
  const comp = factors.competition;
  if (comp.provenance !== "MISSING" && comp.score > 40 && comp.score < 60) warnings.push("Moderate competition");
  if (has(input.saturationScore) && input.saturationScore >= 60) warnings.push("Increasing ad saturation");
  if (has(input.rating) && has(input.reviewCount) && input.reviewCount >= 20 && input.rating < 4) warnings.push(`Below-average rating (${round(input.rating)}★)`);
  if (margin.unitProfit !== undefined && margin.unitProfit < 8 && margin.unitProfit >= 0) warnings.push(`Thin absolute profit per order (${money(margin.unitProfit, input.currency)})`);
  const missing = SCORING_FACTORS.filter((f) => factors[f].provenance === "MISSING" && weights[f] > 0).map((f) => FACTOR_META[f].label.toLowerCase());
  if (missing.length) warnings.push(`Missing data for ${missing.join(", ")} — held at neutral 50; confidence reduced`);
  if (SCORING_FACTORS.some((f) => factors[f].provenance === "DEMO")) warnings.push("Scored on demo data — not a real market signal");

  const risk = assessRisk([input.title, input.description ?? "", input.categorySlug ?? "", ...(input.tags ?? [])].join(" "));
  for (const flag of risk.flags) warnings.push(`Risk: ${flag}`);

  return {
    overall: round(weighted),
    confidence: round(quality, 2),
    factors,
    reasons,
    warnings,
    riskLevel: risk.level,
    riskFlags: risk.flags,
    weights,
    engineVersion: ENGINE_VERSION,
  };
}
