import { z } from "zod";
import { JOB_TYPES } from "@/lib/constants";
import { apiRoute, readJson } from "@/server/auth/api";
import { audit } from "@/server/audit";
import { ValidationError } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";

const RUNNABLE = JOB_TYPES.filter((j) => j !== "notification_dispatch");
const Body = z.object({ type: z.enum(RUNNABLE as [string, ...string[]]), payload: z.record(z.string(), z.unknown()).optional() });

/** POST /api/v1/jobs — { "type": "analytics_sync", "payload": {…} } queues an automation / agent job. */
export const POST = apiRoute({ permission: "jobs:run" }, async (req, ctx) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError(`type must be one of: ${RUNNABLE.join(", ")}`, parsed.error.issues);
  const job = await enqueueJob(ctx.db, { type: parsed.data.type as (typeof JOB_TYPES)[number], orgId: ctx.orgId, payload: parsed.data.payload ?? {}, trigger: "API" });
  await audit(ctx, "job.enqueue", { type: "job", id: String(job.id) }, { job: parsed.data.type, via: "api" });
  return { jobId: job.id, deduped: job.deduped, status: `/api/v1/jobs/${job.id}` };
});
