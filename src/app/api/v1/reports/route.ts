import { apiRoute } from "@/server/auth/api";
import { assertCan } from "@/server/context";
import { enqueueJob } from "@/server/jobs/queue";
import { latestReport } from "@/server/services/reports";

export const dynamic = "force-dynamic";

/** GET /api/v1/reports?type=TOP5_DAILY|TOP5_WEEKLY — the latest Top 5 report. */
export const GET = apiRoute({ permission: "reports:read" }, async (req, ctx) => {
  const t = req.nextUrl.searchParams.get("type");
  return latestReport(ctx, t === "TOP5_WEEKLY" || t === "TOP5_DAILY" ? t : undefined);
});

/** POST /api/v1/reports?type=… — queue a new report. */
export const POST = apiRoute({ permission: "reports:read" }, async (req, ctx) => {
  assertCan(ctx, "agents:run");
  const type = req.nextUrl.searchParams.get("type") === "TOP5_WEEKLY" ? "TOP5_WEEKLY" : "TOP5_DAILY";
  const job = await enqueueJob(ctx.db, { type: "report_generation", orgId: ctx.orgId, payload: { type }, trigger: "API", dedupeKey: `report:${type}:api` });
  return { jobId: job.id, deduped: job.deduped, status: `/api/v1/jobs/${job.id}` };
});
