import { z } from "zod";
import { apiRoute, readJson } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { enqueueJob } from "@/server/jobs/queue";

export const dynamic = "force-dynamic";

const Body = z.object({ keywords: z.array(z.string().max(60)).max(20).optional(), firstRun: z.boolean().optional() });

/** POST /api/v1/discovery — queues discovery across configured sources (or the full first-run workflow). */
export const POST = apiRoute({ permission: "agents:run" }, async (req, ctx) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("Invalid body", parsed.error.issues);
  const type = parsed.data.firstRun ? "first_run" : "product_discovery";
  const job = await enqueueJob(ctx.db, { type, orgId: ctx.orgId, payload: parsed.data.keywords ? { keywords: parsed.data.keywords } : {}, trigger: "API", dedupeKey: `${type}:api` });
  return { jobId: job.id, deduped: job.deduped, status: `/api/v1/jobs/${job.id}` };
});
