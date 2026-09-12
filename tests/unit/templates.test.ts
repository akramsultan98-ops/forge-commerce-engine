import { describe, expect, it } from "vitest";
import { CONTENT_ANGLES } from "@/lib/constants";
import { parseSection, TEMPLATE_LAYOUTS } from "@/lib/landing-sections";
import type { ProductBrief } from "@/server/ai/brief";
import { templateArticle, templateConcepts, templateCopy, templateLandingSections, templateResearch } from "@/server/ai/templates";
import { ConceptSchema, CopySchema, ResearchSchema } from "@/server/ai/schemas";

const brief: ProductBrief = {
  id: "00000000-0000-0000-0000-00000000000a",
  title: "Reusable Pet Hair Remover Roller",
  shortName: "Reusable Pet Hair Remover Roller",
  slug: "reusable-pet-hair-remover-roller",
  description: "A reusable roller that lifts pet hair off sofas.",
  category: "Pets",
  categorySlug: "pets",
  brand: null,
  problem: "pet hair all over the sofa",
  audience: "dog and cat owners",
  highlights: ["No sticky sheets to replace", "Self-cleaning base chamber"],
  tags: ["pets"],
  price: 18.99,
  cost: null,
  shippingCost: null,
  currency: "USD",
  commissionPct: 12,
  commission: 2.28,
  businessModel: "AFFILIATE",
  shippingDaysMin: null,
  shippingDaysMax: null,
  rating: null,
  score: 82,
  confidence: 0.7,
  reasons: ["Strong trend growth", "High visual demonstration potential"],
  warnings: ["Moderate competition"],
  riskFlags: [],
  riskLevel: "LOW",
  factors: { trend: { score: 88, provenance: "REAL", note: "Trend index 88" } },
  isDemo: false,
};

const FABRICATION = /(customers love|people are raving|best[- ]selling|sold out|only \d+ left|limited time|hurry|testimonial|5[- ]star|★★★★★|#1 )/i;

describe("template engine — honest by construction", () => {
  it("writes an investment-style thesis and anti-thesis", () => {
    const r = ResearchSchema.parse(templateResearch(brief));
    expect(r.thesis.startsWith("TEST THIS PRODUCT BECAUSE")).toBe(true);
    expect(r.antiThesis.startsWith("DO NOT TEST THIS PRODUCT BECAUSE")).toBe(true);
    expect(r.verdict).toBe("TEST");
    expect(r.hooks).toHaveLength(5);
    expect(r.ctas).toHaveLength(3);
    expect(r.factorEstimates).toBeNull(); // the template engine never pretends to be an AI judgement
    expect(r.whyTrending).toContain("live data");
  });

  it("admits missing trend data instead of inventing it", () => {
    const r = templateResearch({ ...brief, factors: {} });
    expect(r.whyTrending).toMatch(/No live trend data/);
  });

  it("refuses to recommend HIGH-risk products", () => {
    expect(templateResearch({ ...brief, riskLevel: "HIGH", riskFlags: ["Medical or health claims — regulated advertising"] }).verdict).toBe("DO_NOT_TEST");
  });

  it("produces copy with no fabricated social proof, urgency or ratings", () => {
    const c = CopySchema.parse(templateCopy(brief, { returns: "Merchant returns apply.", shipping: "Shown at checkout." }));
    const all = JSON.stringify(c);
    expect(all).not.toMatch(FABRICATION);
    expect(c.interestPoints.join(" ")).not.toMatch(/★/); // no rating unless a REAL one exists
    expect(templateCopy({ ...brief, rating: { value: 4.6, count: 9100, source: "Amazon" } }, { returns: "r", shipping: "s" }).interestPoints.join(" ")).toContain("4.6★");
    expect(c.faqs.some((f) => /commission/i.test(f.a))).toBe(true); // affiliate disclosure in FAQ
  });

  it("generates short-form scripts with the exact beat structure", () => {
    const concepts = templateConcepts(brief, { platform: "TIKTOK", contentType: "TIKTOK_VIDEO", count: 14 });
    expect(new Set(concepts.map((c) => c.angle)).size).toBe(CONTENT_ANGLES.length);
    for (const c of concepts) {
      ConceptSchema.parse(c);
      expect(c.beats.map((b) => [b.label, b.from, b.to])).toEqual([
        ["HOOK", 0, 3],
        ["PROBLEM", 3, 7],
        ["DEMONSTRATION", 7, 15],
        ["PAYOFF", 15, 22],
        ["CTA", 22, 26],
      ]);
      expect(c.cta).toContain("affiliate link");
      expect(JSON.stringify(c)).not.toMatch(FABRICATION);
    }
  });

  it("uses body text (not beats) for static formats", () => {
    const [carousel] = templateConcepts(brief, { platform: "INSTAGRAM", contentType: "CAROUSEL", count: 1 });
    expect(carousel.beats).toHaveLength(0);
    expect(carousel.body.split("\n")).toHaveLength(5);
  });

  it("assembles every template layout with a disclosure section", () => {
    const copy = templateCopy(brief, { returns: "r", shipping: "s" });
    for (const [key, layout] of Object.entries(TEMPLATE_LAYOUTS)) {
      const sections = templateLandingSections(brief, copy, layout, { disclosure: "Affiliate links…", returns: "r", shipping: "s", template: key as never });
      expect(sections.map((s) => s.type)).toContain("DISCLOSURE");
      for (const s of sections) expect(() => parseSection(s.type as never, s.content)).not.toThrow();
      const proof = sections.find((s) => s.type === "SOCIAL_PROOF");
      if (proof) expect(proof.content.mode).toBe("interest");
    }
  });

  it("writes articles with honest watch-outs", () => {
    const a = templateArticle("LISTICLE", [brief, { ...brief, id: "b", shortName: "Other" }], "Pets");
    expect(a.blocks.filter((b) => b.kind === "product")).toHaveLength(2);
    expect(JSON.stringify(a)).toContain("– Moderate competition");
  });
});
