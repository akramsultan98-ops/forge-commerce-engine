"use server";

import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { JOB_TYPES, PRODUCT_STATUSES, type JobType, type ProductStatus } from "@/lib/constants";
import { actionContext } from "@/server/auth/session";
import { act, formObject, str, type ActionState } from "@/server/actions/util";
import { enqueueJob } from "@/server/jobs/queue";
import { createProduct, deleteProduct, setProductStatus, updateProduct } from "@/server/services/products";
import { scoreProductById } from "@/server/services/scoring";
import { evaluateAllTests, evaluateTest, startTest } from "@/server/services/testing";
import { importCsv } from "@/server/discovery/service";
import { resolveRecommendation } from "@/server/services/recommendations";
import { createQuickExperiment, setExperimentStatus } from "@/server/services/experiments";
import { landingPages, recommendations } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { audit } from "@/server/audit";

export async function createProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await act(async () => {
    const ctx = await actionContext("products:write");
    const p = await createProduct(ctx, formObject(fd), { provenance: "MANUAL", source: "MANUAL_IMPORT", sourceLabel: "operator" });
    await scoreProductById(ctx, p.id);
    id = p.id;
  });
  if (!res?.ok) return res;
  redirect(`/admin/products/${id}`);
}

export async function updateProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("products:write");
    const id = str(fd, "id");
    await updateProduct(ctx, id, formObject(fd, ["id"]), "MANUAL", ctx.userId ? `operator:${ctx.userId.slice(0, 8)}` : "operator");
    const s = await scoreProductById(ctx, id);
    return `Saved and re-scored: ${s.overall}/100.`;
  });
}

export async function setStatusAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("products:write");
    const status = str(fd, "status") as ProductStatus;
    if (!(PRODUCT_STATUSES as readonly string[]).includes(status)) throw new ValidationError("Unknown status");
    await setProductStatus(ctx, str(fd, "id"), status, str(fd, "reason") || undefined);
    return `Status set to ${status}.`;
  });
}

export async function scoreProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("products:write");
    const s = await scoreProductById(ctx, str(fd, "id"));
    return `Scored ${s.overall}/100 (confidence ${s.confidence}).`;
  });
}

export async function deleteProductAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const res = await act(async () => {
    const ctx = await actionContext("products:delete");
    await deleteProduct(ctx, str(fd, "id"));
  });
  if (!res?.ok) return res;
  redirect("/admin/products");
}

const ALLOWED_JOBS = new Set<JobType>(JOB_TYPES.filter((j) => j !== "notification_dispatch"));

/** Generic "run this agent/automation in the background" action. */
export async function enqueueJobAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("agents:run");
    const type = str(fd, "job") as JobType;
    if (!ALLOWED_JOBS.has(type)) throw new ValidationError("Unknown job type");
    const payload: Record<string, unknown> = {};
    for (const key of ["productId", "batch", "platform", "contentType", "template", "type", "angle"]) {
      const v = str(fd, key);
      if (v) payload[key] = v;
    }
    const count = Number(str(fd, "count"));
    if (count) payload.count = Math.min(30, Math.max(1, count));
    if (str(fd, "schedule") === "on") payload.schedule = true;
    const job = await enqueueJob(ctx.db, { type, orgId: ctx.orgId, payload, trigger: "MANUAL", dedupeKey: `${type}:${JSON.stringify(payload)}` });
    await audit(ctx, "job.enqueue", { type: "job", id: String(job.id) }, { job: type, payload });
    return { message: job.deduped ? `An identical ${type.replace(/_/g, " ")} job is already queued (#${job.id}).` : `Queued ${type.replace(/_/g, " ")} (job #${job.id}).`, data: { jobId: job.id } };
  });
}

/** Product Research Agent, portfolio mode: rank the catalog against the operator's constraints. */
export async function researchPortfolioAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("research:run");
    const n = (k: string) => (str(fd, k) ? Number(str(fd, k)) : undefined);
    const payload = {
      market: str(fd, "market") || "US",
      budget: n("budget"),
      businessModel: str(fd, "businessModel") || undefined,
      desiredMarginPct: n("desiredMarginPct"),
      targetAudience: str(fd, "targetAudience") || undefined,
      maxPriceUsd: n("maxPriceUsd"),
      limit: Math.min(20, n("limit") ?? 10),
    };
    const job = await enqueueJob(ctx.db, { type: "product_research", orgId: ctx.orgId, payload, trigger: "MANUAL" });
    await audit(ctx, "job.enqueue", { type: "job", id: String(job.id) }, { job: "product_research", payload });
    return { message: `Research agent ranking the catalog (job #${job.id}).`, data: { jobId: job.id } };
  });
}

export async function startTestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("products:write");
    const productId = str(fd, "id");
    const [page] = await ctx.db.select().from(landingPages).where(eq(landingPages.productId, productId)).orderBy(desc(landingPages.updatedAt)).limit(1);
    if (page && page.status === "DRAFT") await ctx.db.update(landingPages).set({ status: "PUBLISHED", publishedAt: new Date() }).where(eq(landingPages.id, page.id));
    await startTest(ctx, productId);
    return page ? "Landing page published and 14-day test started." : "Test started. Tip: generate a landing page so traffic has somewhere to land.";
  });
}

export async function evaluateTestAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("products:write");
    const id = str(fd, "testId");
    if (!id) {
      const r = await evaluateAllTests(ctx);
      return `Evaluated ${r.evaluated} tests · ${r.winners} winners · ${r.kills} kill recommendations.`;
    }
    const r = await evaluateTest(ctx, id);
    return `Verdict ${r.verdict} → ${r.decision}. ${r.reasons[0] ?? ""}`;
  });
}

export async function importCsvAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("products:write");
    const file = fd.get("file");
    let text = str(fd, "csv");
    if (file && typeof file === "object" && "text" in file && (file as File).size > 0) {
      const f = file as File;
      if (f.size > 5_000_000) throw new ValidationError("CSV must be 5 MB or smaller");
      if (!/\.(csv|txt)$/i.test(f.name) && !/text\/(csv|plain)|application\/vnd\.ms-excel/.test(f.type)) throw new ValidationError("Upload a .csv file");
      text = await f.text();
    }
    if (!text.trim()) throw new ValidationError("Choose a CSV file or paste CSV text");
    const model = str(fd, "businessModel") as "AFFILIATE" | "DROPSHIPPING";
    const r = await importCsv(ctx, text, { defaultBusinessModel: model || "AFFILIATE" });
    const errors = r.errors.length ? ` ${r.errors.length} row(s) skipped (first: line ${r.errors[0].line} — ${r.errors[0].message}).` : "";
    return `Imported ${r.created} new and updated ${r.updated} products — all scored.${errors}`;
  });
}

/** Executes a recommendation's suggested action, then marks it done. */
export async function recommendationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return act(async () => {
    const ctx = await actionContext("agents:run");
    const id = str(fd, "id");
    const mode = str(fd, "mode");
    if (mode === "dismiss") {
      await resolveRecommendation(ctx, id, "DISMISSED");
      return "Dismissed.";
    }
    const [rec] = await ctx.db.select().from(recommendations).where(and(eq(recommendations.id, id), eq(recommendations.organizationId, ctx.orgId))).limit(1);
    if (!rec) throw new ValidationError("Recommendation not found");
    const params = (rec.action?.params ?? {}) as Record<string, unknown>;
    let message = "Marked done.";
    let jobId: number | undefined;
    switch (rec.action?.kind) {
      case "GENERATE_CONTENT": {
        const j = await enqueueJob(ctx.db, { type: "content_generation", orgId: ctx.orgId, payload: { productId: params.productId, count: params.count ?? 5, angle: params.angle, platform: params.platform ?? "TIKTOK", contentType: params.platform === "INSTAGRAM" ? "INSTAGRAM_REEL" : params.platform === "YOUTUBE" ? "YOUTUBE_SHORT" : "TIKTOK_VIDEO" }, trigger: "MANUAL" });
        jobId = j.id;
        message = `Generating content (job #${j.id}).`;
        break;
      }
      case "LAUNCH_TEST": {
        const j = await enqueueJob(ctx.db, { type: "launch_test_kit", orgId: ctx.orgId, payload: { productId: params.productId }, trigger: "MANUAL", dedupeKey: `launch_test_kit:${params.productId}` });
        jobId = j.id;
        message = `Launch kit queued (job #${j.id}).`;
        break;
      }
      case "CREATE_EXPERIMENT": {
        const [page] = await ctx.db.select().from(landingPages).where(eq(landingPages.productId, String(params.productId))).orderBy(desc(landingPages.updatedAt)).limit(1);
        if (!page) throw new ValidationError("This product has no landing page yet");
        const exp = await createQuickExperiment(ctx, page.id, "STRUCTURE", "");
        await setExperimentStatus(ctx, exp.id, "RUNNING");
        message = "Started an A/B test: demo above the fold with a shorter hero.";
        break;
      }
      case "EVALUATE_TEST": {
        const r = await evaluateTest(ctx, String(params.testId));
        message = `Verdict ${r.verdict} → ${r.decision}.`;
        break;
      }
    }
    await resolveRecommendation(ctx, id, "DONE");
    return { message, data: jobId ? { jobId } : undefined };
  });
}
