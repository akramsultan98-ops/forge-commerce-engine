import { describe, expect, it } from "vitest";
import { assessRisk, DEFAULT_WEIGHTS, normalizeWeights, piecewise, scoreProduct, SCORING_FACTORS, type ScoringInput } from "@/domain/scoring";

const strong: ScoringInput = {
  title: "Electric Fabric Shaver",
  businessModel: "AFFILIATE",
  currency: "USD",
  sellingPrice: 19.99,
  commissionPercentage: 12,
  trendScore: 88,
  competitionScore: 35,
  contentScore: 92,
  impulseScore: 84,
  problemScore: 85,
  noveltyScore: 70,
  estimatedSales: 4000,
  provenance: { trendScore: "REAL", commissionPercentage: "REAL", sellingPrice: "REAL", estimatedSales: "ESTIMATED", contentScore: "MANUAL", competitionScore: "MANUAL", impulseScore: "MANUAL", problemScore: "MANUAL", noveltyScore: "MANUAL" },
};

describe("scoring engine", () => {
  it("default weights sum to 100 across nine factors", () => {
    expect(SCORING_FACTORS).toHaveLength(9);
    expect(Object.values(DEFAULT_WEIGHTS).reduce((s, n) => s + n, 0)).toBe(100);
  });

  it("scores a strong product high and explains why", () => {
    const r = scoreProduct(strong);
    expect(r.overall).toBeGreaterThan(75);
    expect(r.overall).toBeLessThanOrEqual(100);
    expect(r.reasons).toContain("Strong trend growth");
    expect(r.reasons).toContain("High visual demonstration potential");
    expect(r.confidence).toBeGreaterThan(0.6);
    expect(r.riskLevel).toBe("LOW");
  });

  it("holds missing factors at neutral 50, lowers confidence and warns", () => {
    const r = scoreProduct({ title: "Mystery gadget", businessModel: "DROPSHIPPING", currency: "USD" });
    for (const f of SCORING_FACTORS.filter((f) => f !== "shipping")) expect(r.factors[f].provenance).toBe("MISSING");
    expect(r.factors.trend.score).toBe(50);
    expect(r.confidence).toBe(0);
    expect(r.warnings.some((w) => w.startsWith("Missing data for"))).toBe(true);
  });

  it("uses commission economics for affiliate and gross margin for dropshipping", () => {
    const aff = scoreProduct({ ...strong, commissionPercentage: 2 });
    expect(aff.factors.margin.note).toContain("2% commission");
    const drop = scoreProduct({ title: "Clip", businessModel: "DROPSHIPPING", currency: "USD", sellingPrice: 20, cost: 4, shippingCost: 2 });
    expect(drop.factors.margin.note).toContain("70% gross margin");
    const thin = scoreProduct({ title: "Clip", businessModel: "DROPSHIPPING", currency: "USD", sellingPrice: 10, cost: 8, shippingCost: 1 });
    expect(thin.factors.margin.score).toBeLessThan(20);
    expect(thin.warnings.some((w) => w.startsWith("Thin margin"))).toBe(true);
  });

  it("flags demo data and ad saturation", () => {
    const r = scoreProduct({ ...strong, saturationScore: 75, provenance: { ...strong.provenance, trendScore: "DEMO" } });
    expect(r.warnings).toContain("Increasing ad saturation");
    expect(r.warnings).toContain("Scored on demo data — not a real market signal");
  });

  it("respects custom weights", () => {
    const trendOnly = normalizeWeights({ trend: 100, velocity: 0, margin: 0, content: 0, problem: 0, impulse: 0, competition: 0, novelty: 0, shipping: 0 });
    expect(scoreProduct({ ...strong, trendScore: 20 }, trendOnly).overall).toBe(20);
    expect(normalizeWeights({ trend: -5 }).trend).toBe(DEFAULT_WEIGHTS.trend);
    expect(normalizeWeights(Object.fromEntries(SCORING_FACTORS.map((f) => [f, 0])))).toEqual(DEFAULT_WEIGHTS);
  });

  it("marks shipping infeasible outside the target market", () => {
    const r = scoreProduct({ ...strong, businessModel: "DROPSHIPPING", countriesAvailable: ["DE"], targetCountries: ["US"] });
    expect(r.factors.shipping.score).toBe(10);
  });

  it("interpolates control points", () => {
    expect(piecewise(5, [[0, 0], [10, 100]])).toBe(50);
    expect(piecewise(-1, [[0, 0], [10, 100]])).toBe(0);
    expect(piecewise(99, [[0, 0], [10, 100]])).toBe(100);
  });
});

describe("risk assessment (section 54)", () => {
  it("rates medical claims and ingestibles HIGH", () => {
    expect(assessRisk("Posture corrector that cures back pain").level).toBe("HIGH");
    expect(assessRisk("Keto weight loss supplement").level).toBe("HIGH");
    expect(assessRisk("Pokémon plush replica").flags.length).toBeGreaterThanOrEqual(1);
  });
  it("rates children's and electrical products MEDIUM", () => {
    expect(assessRisk("Silicone baby teether").level).toBe("MEDIUM");
    expect(assessRisk("Portable space heater").level).toBe("MEDIUM");
  });
  it("leaves ordinary products LOW", () => {
    expect(assessRisk("Magnetic cable organizer for desks").level).toBe("LOW");
  });
});
