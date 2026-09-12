import { describe, expect, it } from "vitest";
import { classifyTest, decide, DEFAULT_TEST_THRESHOLDS, deriveMetrics, type TestMetrics } from "@/domain/testing";

const base: TestMetrics = { days: 10, pageViews: 1000, productClicks: 0, affiliateClicks: 0, conversions: 0, revenue: 0, commission: 0, cost: 0, contentViews: 0, contentEngagements: 0 };

describe("product testing engine", () => {
  it("needs data before a verdict", () => {
    const r = classifyTest({ ...base, days: 3, pageViews: 90 }, "AFFILIATE");
    expect(r.verdict).toBe("INSUFFICIENT_DATA");
    expect(r.reasons[0]).toContain("90 of 300");
  });

  it("classifies a winner on strong CTR, conversion and positive economics", () => {
    const r = classifyTest({ ...base, affiliateClicks: 110, conversions: 22, commission: 44 }, "AFFILIATE");
    expect(r.verdict).toBe("WINNER");
    expect(decide({ verdict: r.verdict, metrics: { ...base, affiliateClicks: 110, conversions: 22, commission: 44 }, model: "AFFILIATE" }).decision).toBe("SCALE");
  });

  it("classifies a failure on weak CTR and conversion", () => {
    const m = { ...base, affiliateClicks: 12, conversions: 1, commission: 1 };
    const r = classifyTest(m, "AFFILIATE");
    expect(r.verdict).toBe("FAILURE");
    expect(decide({ verdict: r.verdict, metrics: m, model: "AFFILIATE" }).decision).toBe("KILL");
  });

  it("recommends OPTIMIZE for good traffic and CTR with poor conversion", () => {
    const m = { ...base, affiliateClicks: 95, conversions: 3, commission: 3 };
    const r = classifyTest(m, "AFFILIATE");
    expect(r.verdict).toBe("PROMISING");
    expect(decide({ verdict: r.verdict, metrics: m, model: "AFFILIATE" }).decision).toBe("OPTIMIZE");
  });

  it("recommends CONTENT_MORE for high engagement and low traffic", () => {
    const m = { ...base, days: 15, pageViews: 60, affiliateClicks: 6, contentViews: 20000, contentEngagements: 1600 };
    const r = classifyTest(m, "AFFILIATE");
    expect(r.verdict).toBe("PROMISING");
    expect(decide({ verdict: r.verdict, metrics: m, model: "AFFILIATE" }).decision).toBe("CONTENT_MORE");
  });

  it("pauses unavailable products and broken links first", () => {
    expect(decide({ verdict: "WINNER", metrics: base, model: "AFFILIATE", available: false }).decision).toBe("PAUSE");
    expect(decide({ verdict: "WINNER", metrics: base, model: "AFFILIATE", linkBroken: true }).decision).toBe("PAUSE");
  });

  it("uses revenue minus cost for owned-inventory economics", () => {
    const d = deriveMetrics({ ...base, productClicks: 100, conversions: 20, revenue: 300, cost: 120 }, "DROPSHIPPING");
    expect(d.earnings).toBe(300);
    expect(d.profit).toBe(180);
    expect(d.roi).toBe(1.5);
    expect(d.affiliateCtr).toBe(0.1);
  });

  it("thresholds are configurable", () => {
    const strict = { ...DEFAULT_TEST_THRESHOLDS, winner: { ...DEFAULT_TEST_THRESHOLDS.winner, minConversionRate: 0.5 } };
    const r = classifyTest({ ...base, affiliateClicks: 110, conversions: 22, commission: 44 }, "AFFILIATE", strict);
    expect(r.verdict).not.toBe("WINNER");
  });
});
