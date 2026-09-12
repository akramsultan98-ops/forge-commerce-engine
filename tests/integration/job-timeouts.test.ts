import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { agentRuns, automationRuns, jobs, type Job } from "@/server/db/schema";
import { claimJobs, completeJob, enqueueJob, getJob, heartbeatJobs, recoverStaleJobs } from "@/server/jobs/queue";
import { executeJob } from "@/server/jobs/runner";
import { runAgent, type AgentDef } from "@/server/agents/runtime";
import { freshDb } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function claimOne(maxAttempts = 3): Promise<Job> {
  await t.db.delete(jobs);
  const { id } = await enqueueJob(t.db, { type: "analytics_sync", orgId: t.orgId, maxAttempts });
  const [job] = await claimJobs(t.db, "worker-a", 1);
  expect(job.id).toBe(id);
  return job;
}

describe("job timeouts", () => {
  it("fails a timed-out job terminally and discards the late result of a handler that ignores the abort", async () => {
    const job = await claimOne();
    let finishedLate = false;
    const r = await executeJob(t.db, job, {
      timeoutMs: 40,
      graceMs: 40,
      handlers: {
        analytics_sync: async () => {
          await sleep(250);
          finishedLate = true;
          return { late: true };
        },
      },
    });
    expect(r).toMatchObject({ ok: false, timedOut: true });
    expect(r.error).toMatch(/did not stop/);
    await sleep(300);
    expect(finishedLate).toBe(true); // it did keep running …
    const row = await getJob(t.db, job.id);
    expect(row).toMatchObject({ status: "failed", attempts: 1, result: null }); // … but its result never landed
    expect(row?.lastError).toMatch(/Not retried automatically/);
    expect(await claimJobs(t.db, "worker-b", 5)).toHaveLength(0); // and it is not re-run
    const [run] = await t.db.select().from(automationRuns).where(eq(automationRuns.jobId, job.id));
    expect(run.status).toBe("failed");
  });

  it("aborts the handler's signal so cooperative work stops", async () => {
    const job = await claimOne();
    const r = await executeJob(t.db, job, {
      timeoutMs: 30,
      graceMs: 500,
      handlers: { analytics_sync: (ctx) => new Promise((_, reject) => ctx.signal!.addEventListener("abort", () => reject(ctx.signal!.reason), { once: true })) },
    });
    expect(r.timedOut).toBe(true);
    expect(r.error).toMatch(/the handler stopped/);
    expect((await getJob(t.db, job.id))?.status).toBe("failed");
  });

  it("stops agents at their next step", async () => {
    const job = await claimOne();
    let steps = 0;
    const ticker: AgentDef<Record<string, never>, unknown> = {
      name: "analytics",
      title: "Ticker",
      description: "test agent",
      tier: "none",
      async run(actx) {
        for (let i = 0; i < 200; i++) {
          await sleep(10);
          actx.step(`tick ${i}`);
          steps++;
        }
        return { done: true };
      },
    };
    const r = await executeJob(t.db, job, { timeoutMs: 60, graceMs: 500, handlers: { analytics_sync: (ctx) => runAgent(ctx, ticker, {}) } });
    expect(r.error).toMatch(/the handler stopped/);
    const stepsAtTimeout = steps;
    await sleep(100);
    expect(steps).toBe(stepsAtTimeout); // no more steps after the abort
    const [agentRun] = await t.db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(1);
    expect(agentRun).toMatchObject({ status: "failed" });
    expect(agentRun.error).toMatch(/timeout/);
  });

  it("keeps the lease alive with heartbeats while a handler runs", async () => {
    const job = await claimOne();
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(jobs.id, job.id));
    const r = await executeJob(t.db, job, {
      heartbeatMs: 10,
      handlers: {
        analytics_sync: async () => {
          await sleep(80);
          const row = await getJob(t.db, job.id);
          return { fresh: Date.now() - row!.lockedAt!.getTime() < 60_000 };
        },
      },
    });
    expect(r).toMatchObject({ ok: true, result: { fresh: true } });
  });
});

describe("job leases", () => {
  it("fences completion: a worker that lost its lease cannot overwrite the outcome", async () => {
    const job = await claimOne();
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(jobs.id, job.id));
    await recoverStaleJobs(t.db);
    const [again] = await claimJobs(t.db, "worker-b", 1);
    expect(again.id).toBe(job.id);
    expect(await completeJob(t.db, job, { stale: true })).toBe(false);
    expect((await getJob(t.db, job.id))?.status).toBe("running");
    expect(await completeJob(t.db, again, { fresh: true })).toBe(true);
    expect((await getJob(t.db, job.id))?.result).toEqual({ fresh: true });
  });

  it("discards a handler's result when its lease was lost mid-run", async () => {
    const job = await claimOne();
    const r = await executeJob(t.db, job, {
      handlers: {
        analytics_sync: async () => {
          // Simulate the reaper + another worker taking over while this handler was still running.
          await t.db.update(jobs).set({ lockedBy: "worker-b", attempts: 2 }).where(eq(jobs.id, job.id));
          return { mine: true };
        },
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Lease lost/);
    expect((await getJob(t.db, job.id))).toMatchObject({ status: "running", lockedBy: "worker-b", result: null });
  });

  it("recovers only silent jobs, and fails them once attempts are exhausted", async () => {
    await t.db.delete(jobs);
    const live = await enqueueJob(t.db, { type: "analytics_sync", orgId: t.orgId });
    const silent = await enqueueJob(t.db, { type: "trend_refresh", orgId: t.orgId });
    const exhausted = await enqueueJob(t.db, { type: "product_scoring", orgId: t.orgId, maxAttempts: 1 });
    expect(await claimJobs(t.db, "worker-a", 3)).toHaveLength(3);
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60_000) });
    expect(await heartbeatJobs(t.db, "worker-a", [live.id])).toBe(1);
    expect(await heartbeatJobs(t.db, "someone-else", [silent.id])).toBe(0);
    expect(await recoverStaleJobs(t.db)).toBe(2);
    expect((await getJob(t.db, live.id))?.status).toBe("running");
    expect((await getJob(t.db, silent.id))?.status).toBe("queued");
    expect((await getJob(t.db, exhausted.id))?.status).toBe("failed");
  });
});
