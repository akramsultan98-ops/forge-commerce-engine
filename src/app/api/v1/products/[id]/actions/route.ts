import { z } from "zod";
import { apiRoute, readJson } from "@/server/auth/api";
import { assertCan } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/queue";
import { getProduct } from "@/server/services/products";
import { scoreProductById } from "@/server/services/scoring";
import { startTest } from "@/server/services/testing";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["score", "research", "launch", "landing_page", "content", "start_test"]),
  template: z.enum(["PROBLEM_SOLUTION", "VIRAL", "PREMIUM", "IMPULSE", "UGC"]).optional(),
  batch: z.enum(["launch", "full", "scale"]).optional(),
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "PINTEREST", "FACEBOOK", "X"]).optional(),
  contentType: z.string().max(40).optional(),
  count: z.number().int().min(1).max(30).optional(),
});

/**
 * POST /api/v1/products/{id}/actions
 * score & start_test run synchronously; research / launch / landing_page / content are queued as jobs.
 */
export const POST = apiRoute<{ id: string }>({ permission: "products:read" }, async (req, ctx, { id }) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("Invalid action", parsed.error.issues);
  const b = parsed.data;
  await getProduct(ctx, id);
  if (b.action === "score") {
    assertCan(ctx, "products:write");
    const s = await scoreProductById(ctx, id);
    return { overall: s.overall, confidence: s.confidence, reasons: s.reasons, warnings: s.warnings, factors: s.factors };
  }
  if (b.action === "start_test") {
    assertCan(ctx, "products:write");
    return { test: await startTest(ctx, id) };
  }
  assertCan(ctx, "agents:run");
  const type = { research: "product_research", launch: "launch_test_kit", landing_page: "landing_page_generation", content: "content_generation" }[b.action] as "product_research";
  const payload: Record<string, unknown> = { productId: id, template: b.template, batch: b.batch ?? (b.action === "content" && !b.platform ? "launch" : undefined), platform: b.platform, contentType: b.contentType, count: b.count };
  const job = await enqueueJob(ctx.db, { type, orgId: ctx.orgId, payload: Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)), trigger: "API" });
  return { jobId: job.id, deduped: job.deduped, status: `/api/v1/jobs/${job.id}` };
});
