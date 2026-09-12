// Postgres-backed job queue. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so any number of
// worker processes can run concurrently without double-processing. A running job is a lease: its
// worker heartbeats the lock, completion/failure is fenced on (lockedBy, attempts) so a worker that
// lost its lease can never overwrite the outcome, and only jobs whose worker went silent are
// recovered. Failed jobs retry with exponential backoff.

import { and, asc, desc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { jobs, type Job } from "../db/schema";
import type { JobType } from "@/lib/constants";

/** A running job's lock is refreshed every 30 s; after this long without a heartbeat its worker is presumed dead. */
export const STALE_LOCK_MS = 5 * 60_000;

export interface EnqueueOptions {
  type: JobType;
  payload?: Record<string, unknown>;
  orgId?: string | null;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  /** While a job with this key is queued or running, identical enqueues are de-duplicated. */
  dedupeKey?: string;
  trigger?: "MANUAL" | "SCHEDULE" | "EVENT" | "API" | "SYSTEM";
}

export async function enqueueJob(db: Database, opts: EnqueueOptions): Promise<{ id: number; deduped: boolean }> {
  const inserted = await db
    .insert(jobs)
    .values({
      type: opts.type,
      payload: opts.payload ?? {},
      organizationId: opts.orgId ?? null,
      runAt: opts.runAt ?? new Date(),
      priority: opts.priority ?? 0,
      maxAttempts: opts.maxAttempts ?? 3,
      dedupeKey: opts.dedupeKey ?? null,
      trigger: opts.trigger ?? "MANUAL",
    })
    .onConflictDoNothing()
    .returning({ id: jobs.id });
  if (inserted[0]) return { id: inserted[0].id, deduped: false };
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.dedupeKey, opts.dedupeKey ?? ""), inArray(jobs.status, ["queued", "running"])))
    .limit(1);
  return { id: existing?.id ?? -1, deduped: true };
}

export async function claimJobs(db: Database, workerId: string, limit: number): Promise<Job[]> {
  if (limit <= 0) return [];
  const candidates = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, sql`now()`)))
    .orderBy(desc(jobs.priority), asc(jobs.runAt), asc(jobs.id))
    .limit(limit)
    .for("update", { skipLocked: true });
  return db
    .update(jobs)
    .set({ status: "running", lockedAt: sql`now()`, lockedBy: workerId, attempts: sql`${jobs.attempts} + 1` })
    .where(inArray(jobs.id, candidates))
    .returning();
}

/** The lease a worker got from claimJobs: only the same owner on the same attempt may finish the job. */
export type JobLease = Pick<Job, "id" | "attempts" | "lockedBy">;
const holds = (job: JobLease) =>
  and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.attempts, job.attempts), job.lockedBy === null ? isNull(jobs.lockedBy) : eq(jobs.lockedBy, job.lockedBy));

/** Marks the job succeeded. Returns false (and changes nothing) if the lease was lost. */
export async function completeJob(db: Database, job: JobLease, result: unknown): Promise<boolean> {
  const rows = await db
    .update(jobs)
    .set({ status: "succeeded", result: (result ?? null) as never, finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
    .where(holds(job))
    .returning({ id: jobs.id });
  return rows.length > 0;
}

export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

/** Fails (terminal) or re-queues with backoff. Fenced like completeJob. Returns whether the failure is final. */
export async function failJob(db: Database, job: JobLease & Pick<Job, "maxAttempts">, error: string, retryable = true) {
  const final = !retryable || job.attempts >= job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: final ? "failed" : "queued",
      lastError: error.slice(0, 4000),
      runAt: final ? undefined : new Date(Date.now() + backoffMs(job.attempts)),
      finishedAt: final ? new Date() : null,
      lockedAt: null,
      lockedBy: null,
    })
    .where(holds(job));
  return final;
}

/** Refreshes the lock of jobs this worker is still running, so the stale-job reaper leaves them alone. */
export async function heartbeatJobs(db: Database, workerId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await db
    .update(jobs)
    .set({ lockedAt: sql`now()` })
    .where(and(inArray(jobs.id, ids), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Recovers jobs whose worker stopped heartbeating (crash, kill -9): re-queued, or failed once attempts are exhausted. */
export async function recoverStaleJobs(db: Database, staleMs = STALE_LOCK_MS) {
  const stale = and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(Date.now() - staleMs)));
  const failed = await db
    .update(jobs)
    .set({ status: "failed", finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: "Worker stopped responding and no attempts remain" })
    .where(and(stale, sql`${jobs.attempts} >= ${jobs.maxAttempts}`))
    .returning({ id: jobs.id });
  const requeued = await db
    .update(jobs)
    .set({ status: "queued", runAt: new Date(), lockedAt: null, lockedBy: null, lastError: "Recovered: worker stopped responding" })
    .where(stale)
    .returning({ id: jobs.id });
  return failed.length + requeued.length;
}

export async function retryJob(db: Database, id: number) {
  await db
    .update(jobs)
    .set({ status: "queued", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null })
    .where(and(eq(jobs.id, id), inArray(jobs.status, ["failed", "cancelled"])));
}

export async function cancelJob(db: Database, id: number) {
  await db
    .update(jobs)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.status, "queued")));
}

export async function getJob(db: Database, id: number) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row ?? null;
}
