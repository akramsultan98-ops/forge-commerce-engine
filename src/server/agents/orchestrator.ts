// FORGE ORCHESTRATOR — composes the agents into pipelines. The headline pipeline is the
// Launch Test Kit: "find a promising product" → researched → scored → landing page → content →
// tracking → ready to publish, in one background job.

import { and, eq } from "drizzle-orm";
import { affiliateLinks, products } from "../db/schema";
import { primaryLinkFor, createLink } from "../services/affiliate";
import { getProduct, setProductStatus } from "../services/products";
import { runDiscovery } from "../discovery/service";
import { selectTop5Candidates } from "../services/reports";
import { getSetting, setSetting } from "../settings";
import {
  analyticsAgent,
  contentAgent,
  landingPageAgent,
  optimizationAgent,
  reportingAgent,
  researchAgent,
  scoringAgent,
  trendAgent,
} from "./agents";
import { runAgent, type AgentContext, type AgentDef } from "./runtime";

export type OrchestratorInput =
  | { pipeline: "launch_test_kit"; productId: string; contentBatch?: "launch" | "full" }
  | { pipeline: "daily_cycle" }
  | { pipeline: "first_run"; launchTop?: number }
  | { pipeline: "discover"; keywords?: string[] };

async function launchTestKit(ctx: AgentContext, productId: string, batch: "launch" | "full" = "launch") {
  const product = await getProduct(ctx, productId);
  const child = { parentRunId: ctx.runId, productId };
  ctx.step(`Launch kit for “${product.title}”`);
  const research = await runAgent(ctx, researchAgent, { productId }, child);
  const score = await runAgent(ctx, scoringAgent, { productId }, child);
  const page = await runAgent(ctx, landingPageAgent, { productId }, child);
  const content = await runAgent(ctx, contentAgent, { productId, batch, schedule: true }, child);

  // Tracking: make sure a tracked /r/ link exists for the affiliate destination.
  let link = await primaryLinkFor(ctx.db, productId);
  // Every outbound click goes through a tracked /r/ link: the affiliate deep link, or the store/checkout URL.
  const destination = product.affiliateUrl ?? product.productUrl ?? null;
  if (!link && destination) {
    link = await createLink({ ...ctx, role: "admin" }, { productId, url: destination, merchant: product.brand ?? undefined, commissionRate: product.commissionPercentage ?? undefined, isPrimary: true }, { isDemo: product.isDemo });
    ctx.step(`Tracked link /r/${link.code} created`);
  }
  if (["DISCOVERED", "RESEARCHING"].includes((await getProduct(ctx, productId)).status)) {
    await setProductStatus({ ...ctx, role: "admin" }, productId, "APPROVED", "Launch kit generated — ready to publish");
  }
  return {
    productId,
    researchRunId: research.runId,
    score: score.output,
    landingPage: page.output,
    content: content.output,
    trackedLinkCode: link?.code ?? null,
    readyToPublish: true,
    nextStep: "Review the landing page draft, publish it, then start the 14-day test.",
  };
}

export const orchestrator: AgentDef<OrchestratorInput, unknown> = {
  name: "orchestrator",
  title: "FORGE Orchestrator",
  description: "Discovers, researches, scores and selects products; generates pages and content; tracks, analyses and recommends — by delegating to specialist agents.",
  tier: "none",
  async run(ctx, input) {
    switch (input.pipeline) {
      case "launch_test_kit":
        return launchTestKit(ctx, input.productId, input.contentBatch);
      case "discover": {
        const summary = await runDiscovery(ctx, { keywords: input.keywords });
        ctx.step(`Discovery created ${summary.created.length} products`);
        return summary;
      }
      case "daily_cycle": {
        const child = { parentRunId: ctx.runId };
        const trend = await runAgent(ctx, trendAgent, {}, child);
        const discovery = await runDiscovery(ctx);
        const scoring = await runAgent(ctx, scoringAgent, {}, child);
        const analytics = await runAgent(ctx, analyticsAgent, {}, child);
        const optimization = await runAgent(ctx, optimizationAgent, {}, child);
        const report = await runAgent(ctx, reportingAgent, { type: "TOP5_DAILY" }, child);
        return { trend: trend.output, discovery: { created: discovery.created.length, adapters: discovery.adapters }, scoring: scoring.output, analytics: analytics.output, optimization: optimization.output, report: report.output };
      }
      case "first_run": {
        const child = { parentRunId: ctx.runId };
        ctx.step("First run: discovery → trends → scoring → Top 5 → launch kits");
        const discovery = await runDiscovery(ctx);
        const trend = await runAgent(ctx, trendAgent, {}, child);
        await runAgent(ctx, scoringAgent, {}, child);
        const report = await runAgent(ctx, reportingAgent, { type: "TOP5_DAILY" }, child);
        const top = await selectTop5Candidates(ctx, input.launchTop ?? 5);
        const kits = [];
        for (const p of top) {
          const hasLink = await ctx.db.select({ id: affiliateLinks.id }).from(affiliateLinks).where(and(eq(affiliateLinks.productId, p.id))).limit(1);
          kits.push({ title: p.title, ...(await launchTestKit(ctx, p.id)), hadLink: hasLink.length > 0 });
        }
        const onboarding = await getSetting(ctx, "onboarding");
        await setSetting({ ...ctx, role: "admin" }, "onboarding", { ...onboarding, firstRunAt: new Date().toISOString() });
        const demo = (await ctx.db.select({ isDemo: products.isDemo }).from(products).where(eq(products.organizationId, ctx.orgId))).every((p) => p.isDemo);
        return { discovery: { created: discovery.created.length, adapters: discovery.adapters }, trend: trend.output, report: report.output, launched: kits.map((k) => ({ productId: k.productId, title: k.title, landingPage: k.landingPage, content: k.content })), dataLabel: demo ? "DEMO DATA — no live sources connected" : "Mixed live + estimated data (see provenance)" };
      }
    }
  },
};
