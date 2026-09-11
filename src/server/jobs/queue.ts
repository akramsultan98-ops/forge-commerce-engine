// Postgres-backed job queue. Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so any number of
// worker processes can run concurrently without double-processing. Failed jobs retry with
// exponential backoff; jobs orphaned by a crashed worker are recovered after a lock timeout.

import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { jobs, type Job } from "../db/schema";
import type { JobType } from "@/lib/constants";

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

export async function completeJob(db: Database, id: number, result: unknown) {
  await db
    .update(jobs)
    .set({ status: "succeeded", result: (result ?? null) as never, finishedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
    .where(eq(jobs.id, id));
}

export function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export async function failJob(db: Database, job: Pick<Job, "id" | "attempts" | "maxAttempts">, error: string, retryable = true) {
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
    .where(eq(jobs.id, job.id));
  return final;
}

/** Re-queues jobs whose worker died mid-run (lock older than `staleMs`). */
export async function recoverStaleJobs(db: Database, staleMs = 15 * 60_000) {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null, lockedBy: null, lastError: "Recovered after worker lock timeout" })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
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
