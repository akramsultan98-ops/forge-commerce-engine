import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { automationRuns, jobSchedules, jobs } from "@/server/db/schema";
import { claimJobs, completeJob, enqueueJob, failJob, getJob, recoverStaleJobs } from "@/server/jobs/queue";
import { drainQueue } from "@/server/jobs/runner";
import { enqueueDueSchedules, ensureDefaultSchedules } from "@/server/jobs/scheduler";
import { createProduct } from "@/server/services/products";
import { freshDb, sampleProduct } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

describe("job queue", () => {
  it("de-duplicates active jobs by key", async () => {
    const a = await enqueueJob(t.db, { type: "trend_refresh", orgId: t.orgId, dedupeKey: "dup" });
    const b = await enqueueJob(t.db, { type: "trend_refresh", orgId: t.orgId, dedupeKey: "dup" });
    expect(b).toEqual({ id: a.id, deduped: true });
  });

  it("claims with SKIP LOCKED, completes, and retries with backoff", async () => {
    await t.db.delete(jobs);
    const { id } = await enqueueJob(t.db, { type: "analytics_sync", orgId: t.orgId, maxAttempts: 2 });
    const [claimed] = await claimJobs(t.db, "w1", 5);
    expect(claimed.id).toBe(id);
    expect(claimed.status).toBe("running");
    expect(await claimJobs(t.db, "w2", 5)).toHaveLength(0);
    expect(await failJob(t.db, claimed, "boom")).toBe(false);
    const retried = await getJob(t.db, id);
    expect(retried?.status).toBe("queued");
    expect(retried!.runAt.getTime()).toBeGreaterThan(Date.now());
    await t.db.update(jobs).set({ runAt: new Date(0) }).where(eq(jobs.id, id));
    const [again] = await claimJobs(t.db, "w1", 1);
    expect(await failJob(t.db, again, "boom again")).toBe(true);
    expect((await getJob(t.db, id))?.status).toBe("failed");
  });

  it("recovers jobs from crashed workers", async () => {
    const { id } = await enqueueJob(t.db, { type: "trend_refresh", orgId: t.orgId });
    await claimJobs(t.db, "dead-worker", 1);
    await t.db.update(jobs).set({ lockedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(jobs.id, id));
    expect(await recoverStaleJobs(t.db, 15 * 60_000)).toBeGreaterThanOrEqual(1);
    await completeJob(t.db, id, { ok: true });
    expect((await getJob(t.db, id))?.status).toBe("succeeded");
  });

  it("executes real handlers and records automation runs", async () => {
    await t.db.delete(jobs);
    await createProduct(t.ctx, sampleProduct());
    await enqueueJob(t.db, { type: "product_scoring", orgId: t.orgId });
    const results = await drainQueue(t.db);
    expect(results).toEqual([expect.objectContaining({ type: "product_scoring", ok: true })]);
    const runs = await t.db.select().from(automationRuns).where(eq(automationRuns.automation, "product_scoring"));
    expect(runs[0].status).toBe("succeeded");
  });

  it("enqueues due cron schedules exactly once per slot", async () => {
    await t.db.delete(jobs);
    await ensureDefaultSchedules(t.db, t.orgId);
    await t.db.update(jobSchedules).set({ nextRunAt: new Date(Date.now() - 1000) }).where(eq(jobSchedules.key, "daily_scoring"));
    const first = await enqueueDueSchedules(t.db);
    const second = await enqueueDueSchedules(t.db);
    expect(first.enqueued).toBe(1);
    expect(second.due).toBe(0);
    const [s] = await t.db.select().from(jobSchedules).where(eq(jobSchedules.key, "daily_scoring"));
    expect(s.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });
});
