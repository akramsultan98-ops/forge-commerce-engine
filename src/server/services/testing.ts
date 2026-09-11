// Product Testing Engine + Kill/Scale decisions (applies the pure domain rules to live metrics).

import { and, desc, eq } from "drizzle-orm";
import { classifyTest, decide, type TestMetrics, type TestThresholds } from "@/domain/testing";
import { assertCan, type ServiceContext } from "../context";
import { affiliateLinks, productDecisions, productTests, products } from "../db/schema";
import { getSetting } from "../settings";
import { productStats } from "./analytics";
import { notify } from "./notifications";
import { getProduct, setProductStatus } from "./products";
import { NotFoundError } from "../errors";

export async function startTest(ctx: ServiceContext, productId: string) {
  assertCan(ctx, "products:write");
  const product = await getProduct(ctx, productId);
  if (product.status !== "TESTING") await setProductStatus(ctx, productId, "TESTING", "Test started");
  const [test] = await ctx.db.select().from(productTests).where(and(eq(productTests.productId, productId), eq(productTests.status, "RUNNING"))).orderBy(desc(productTests.startedAt)).limit(1);
  return test;
}

export async function listTests(ctx: Pick<ServiceContext, "db" | "orgId">, opts: { status?: "RUNNING" | "COMPLETED" } = {}) {
  return ctx.db
    .select({ test: productTests, title: products.title, slug: products.slug, businessModel: products.businessModel, productStatus: products.status, score: products.overallScore, isDemo: products.isDemo })
    .from(productTests)
    .innerJoin(products, eq(products.id, productTests.productId))
    .where(and(eq(productTests.organizationId, ctx.orgId), opts.status ? eq(productTests.status, opts.status) : undefined))
    .orderBy(desc(productTests.startedAt));
}

export async function evaluateTest(ctx: ServiceContext, testId: string) {
  const [test] = await ctx.db.select().from(productTests).where(and(eq(productTests.id, testId), eq(productTests.organizationId, ctx.orgId))).limit(1);
  if (!test) throw new NotFoundError("Test");
  const product = await getProduct(ctx, test.productId);
  const thresholds = { ...(await getSetting(ctx, "testing.thresholds")), ...(test.thresholds as Partial<TestThresholds>) } as TestThresholds;
  const stats = await productStats(ctx, product.id, test.startedAt);
  const days = Math.max(0, Math.floor((Date.now() - test.startedAt.getTime()) / 86400_000));
  const metrics: TestMetrics = { days, ...stats };
  const classification = classifyTest(metrics, product.businessModel, thresholds);
  const [primary] = await ctx.db.select({ status: affiliateLinks.status }).from(affiliateLinks).where(and(eq(affiliateLinks.productId, product.id), eq(affiliateLinks.isPrimary, true))).limit(1);
  const decision = decide({ verdict: classification.verdict, metrics, model: product.businessModel, thresholds, available: product.available, linkBroken: primary?.status === "BROKEN" });
  const finished = classification.verdict === "WINNER" || classification.verdict === "FAILURE" || days >= test.plannedDays;
  const derived = classification.derived;

  await ctx.db
    .update(productTests)
    .set({
      verdict: classification.verdict,
      decision: decision.decision,
      metrics: { ...metrics, affiliateCtr: derived.affiliateCtr, conversionRate: derived.conversionRate, profit: derived.profit, roi: derived.roi ?? 0, engagementRate: derived.engagementRate },
      reasons: [...classification.reasons, ...decision.reasons],
      lastEvaluatedAt: new Date(),
      ...(finished ? { status: "COMPLETED", endedAt: new Date() } : {}),
    })
    .where(eq(productTests.id, test.id));
  await ctx.db.insert(productDecisions).values({ organizationId: ctx.orgId, productId: product.id, decision: decision.decision, verdict: classification.verdict, reasons: decision.reasons, metrics: { ...metrics } });

  // Winners are promoted automatically (spec: "When product becomes WINNER → generate new content batch").
  // Kills are recommended, not executed — an operator confirms with one click.
  if (classification.verdict === "WINNER" && product.status === "TESTING") {
    await setProductStatus({ ...ctx, role: "admin" }, product.id, "WINNER", classification.reasons.join("; "));
  } else if (decision.decision === "KILL") {
    await notify(ctx, { type: "PRODUCT_KILL", severity: "warning", title: `${product.title} should be killed`, body: decision.reasons.join(" "), entity: { type: "product", id: product.id } });
  }
  return { verdict: classification.verdict, decision: decision.decision, reasons: [...classification.reasons, ...decision.reasons], metrics, finished };
}

export async function evaluateAllTests(ctx: ServiceContext) {
  const running = await ctx.db.select({ id: productTests.id }).from(productTests).where(and(eq(productTests.organizationId, ctx.orgId), eq(productTests.status, "RUNNING")));
  const results = [];
  for (const t of running) results.push(await evaluateTest(ctx, t.id));
  return { evaluated: results.length, winners: results.filter((r) => r.verdict === "WINNER").length, kills: results.filter((r) => r.decision === "KILL").length };
}

export async function latestDecision(ctx: Pick<ServiceContext, "db">, productId: string) {
  const [row] = await ctx.db.select().from(productDecisions).where(eq(productDecisions.productId, productId)).orderBy(desc(productDecisions.createdAt)).limit(1);
  return row ?? null;
}
