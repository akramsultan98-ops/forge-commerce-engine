import { apiRoute } from "@/server/auth/api";
import { getJob } from "@/server/jobs/queue";
import { NotFoundError } from "@/server/errors";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ id: string }>({ permission: "dashboard:read" }, async (_req, ctx, { id }) => {
  const job = await getJob(ctx.db, Number(id));
  if (!job || (job.organizationId && job.organizationId !== ctx.orgId)) throw new NotFoundError("Job");
  return { id: job.id, type: job.type, status: job.status, attempts: job.attempts, maxAttempts: job.maxAttempts, lastError: job.lastError, result: job.status === "succeeded" ? job.result : null, createdAt: job.createdAt, finishedAt: job.finishedAt };
});
