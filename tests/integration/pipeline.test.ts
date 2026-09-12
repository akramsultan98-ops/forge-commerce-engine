// The core promise: "find a promising product" → researched → scored → landing page → content →
// tracking → ready to publish — then test, report, recommend and command.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { affiliateLinks, agentRuns, aiUsage, content, landingPageSections, landingPages, productResearch, products } from "@/server/db/schema";
import { runAgent } from "@/server/agents/runtime";
import { orchestrator } from "@/server/agents/orchestrator";
import { createProduct, getProduct } from "@/server/services/products";
import { startTest } from "@/server/services/testing";
import { generateTop5Report } from "@/server/services/reports";
import { executeCommand } from "@/server/command/executor";
import { aiStructured } from "@/server/ai/service";
import { ResearchSchema } from "@/server/ai/schemas";
import { asRole, freshDb, sampleProduct } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
let productId = "";
beforeAll(async () => {
  t = await freshDb();
  const p = await createProduct(t.ctx, sampleProduct({ title: "Silicone Stretch Lids (6-Pack)", problemSolved: "leftover bowls with no lid that fits", productUrl: "https://example.com/store/lids" }));
  productId = p.id;
});
afterAll(async () => t.close());

describe("launch test kit (time from discovery to first test)", () => {
  it("generates research, score, landing page, 10 concepts and a tracked link in one run", async () => {
    const { runId, output } = await runAgent(t.ctx, orchestrator, { pipeline: "launch_test_kit", productId });
    const kit = output as { readyToPublish: boolean; trackedLinkCode: string; landingPage: { landingPageId: string } };
    expect(kit.readyToPublish).toBe(true);

    const research = await t.db.select().from(productResearch).where(eq(productResearch.productId, productId));
    expect(research).toHaveLength(1);
    expect(research[0].generationMethod).toBe("TEMPLATE"); // DEMO_MODE: no paid AI calls
    expect(research[0].thesis).toMatch(/^TEST THIS PRODUCT BECAUSE/);

    const [page] = await t.db.select().from(landingPages).where(eq(landingPages.id, kit.landingPage.landingPageId));
    expect(page.status).toBe("DRAFT");
    expect(page.seoTitle.length).toBeLessThanOrEqual(70);
    const sections = await t.db.select().from(landingPageSections).where(eq(landingPageSections.landingPageId, page.id));
    expect(sections.map((s) => s.type)).toEqual(expect.arrayContaining(["HERO", "FAQ", "CTA", "DISCLOSURE"]));

    const items = await t.db.select().from(content).where(eq(content.productId, productId));
    expect(items).toHaveLength(10);
    expect(new Set(items.map((i) => i.utmContent)).size).toBe(10);
    expect(items.every((i) => i.platform === "TIKTOK" && i.script?.length === 5 && i.scheduledAt)).toBe(true);

    const [link] = await t.db.select().from(affiliateLinks).where(eq(affiliateLinks.productId, productId));
    expect(link.code).toBe(kit.trackedLinkCode);
    expect((await getProduct(t.ctx, productId)).status).toBe("APPROVED");

    const children = await t.db.select().from(agentRuns).where(eq(agentRuns.parentRunId, runId));
    expect(children.map((c) => c.agent)).toEqual(expect.arrayContaining(["research", "scoring", "landing_page", "content"]));
    const usage = await t.db.select().from(aiUsage);
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.provider === "template" && u.estimatedCostUsd === 0)).toBe(true);
  });

  it("starts a test and moves the product to TESTING", async () => {
    const test = await startTest(t.ctx, productId);
    expect(test.status).toBe("RUNNING");
    expect((await getProduct(t.ctx, productId)).status).toBe("TESTING");
  });

  it("builds a Top 5 report with evidence and never claims live sales data", async () => {
    await createProduct(t.ctx, sampleProduct({ title: "Second candidate" }));
    const report = await generateTop5Report(t.ctx, "TOP5_DAILY");
    const entries = report.content.entries as Array<Record<string, unknown>>;
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (const e of entries) {
      for (const k of ["whyTrending", "estimatedDemand", "estimatedCompetition", "supplierCost", "suggestedPrice", "estimatedMargin", "affiliateCommission", "contentOpportunity", "targetCustomer", "marketingAngle", "tiktokHook", "landingAngle", "riskLevel", "overallScore", "sourceEvidence", "recommendedAction"]) expect(e).toHaveProperty(k);
    }
    expect(String(report.content.note)).toMatch(/never presents estimates or AI inference as real sales data/);
  });

  it("translates commands into queries and background jobs, respecting roles", async () => {
    const find = await executeCommand(t.ctx, "Find me 10 products under $30 with strong TikTok potential.");
    expect(find.intent).toBe("FIND_PRODUCTS");
    expect(find.products?.length).toBeGreaterThan(0);
    const launch = await executeCommand(t.ctx, "Launch a test for Second candidate");
    expect(launch.job?.type).toBe("launch_test_kit");
    const viewer = await executeCommand(asRole(t.ctx, "viewer"), "Generate 20 TikTok ideas for Second candidate");
    expect(viewer.job).toBeUndefined();
    expect(viewer.reply).toMatch(/viewer/);
  });

  it("falls back to the template engine when AI is unavailable (never fabricates an AI answer)", async () => {
    const r = await aiStructured(t.ctx, { task: "research", schema: ResearchSchema, schemaName: "x", system: "s", prompt: "p", fallback: () => ({ verdict: "WATCH" as const, thesis: "TEST THIS PRODUCT BECAUSE t", antiThesis: "DO NOT TEST THIS PRODUCT BECAUSE a", whyTrending: "", demand: "", competition: "", supplierNotes: "", shippingNotes: "", socialPotential: "", contentOpportunity: "", targetCustomer: "", marketingAngles: [], hooks: [], ctas: [], landingAngle: "", risks: [], riskLevel: "LOW" as const, recommendedAction: "", suggestedPrice: null, factorEstimates: null }) });
    expect(r.method).toBe("TEMPLATE");
    expect(r.note).toMatch(/DEMO_MODE/);
    const [p] = await t.db.select().from(products).where(eq(products.id, productId));
    expect(p.fieldProvenance.contentScore.p).not.toBe("AI_INFERENCE");
  });
});
