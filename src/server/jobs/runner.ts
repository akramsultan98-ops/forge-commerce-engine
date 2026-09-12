// Worker: polls the queue, executes handlers under a lease (heartbeat + fenced completion) with a
// hard timeout, records automation runs, enqueues due cron schedules and recovers jobs orphaned by
// crashed workers.
//
// Timeouts: the handler's AbortSignal fires (agents and AI calls stop at their next step), the job
// is failed TERMINALLY — never retried automatically, because a handler that ignores the signal may
// still be running — and any late result is discarded (fencing) and logged, never silently applied.

import os from "node:os";
import { eq } from "drizzle-orm";
import type { ServiceContext } from "../context";
import { systemContext } from "../context";
import type { Database } from "../db/client";
import { automationRuns, type Job } from "../db/schema";
import { captureException } from "../errors";
import { logger } from "../logging/logger";
import { ensureDefaultOrganization } from "../services/org";
import { STALE_LOCK_MS, claimJobs, completeJob, failJob, heartbeatJobs, recoverStaleJobs } from "./queue";
import { JOB_HANDLERS } from "./handlers";
import { enqueueDueSchedules } from "./scheduler";

export const JOB_TIMEOUT_MS = 20 * 60_000;
const HEARTBEAT_MS = 30_000;
/** After a timeout, how long to wait for the handler to honour the abort before giving up on it. */
const ABORT_GRACE_MS = 30_000;

export type JobHandler = (ctx: ServiceContext, payload: Record<string, unknown>) => Promise<unknown>;

export interface ExecuteOptions {
  timeoutMs?: number;
  graceMs?: number;
  heartbeatMs?: number;
  /** Test seam: override handlers by job type. */
  handlers?: Partial<Record<string, JobHandler>>;
}

export class JobTimeoutError extends Error {
  constructor(ms: number) {
    super(`Job exceeded its ${formatMs(ms)} timeout`);
    this.name = "JobTimeoutError";
  }
}

function formatMs(ms: number) {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`;
}

type Settled<T> = { kind: "done"; value: T } | { kind: "error"; error: unknown } | { kind: "timeout" };
function within<T>(p: Promise<T>, ms: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ kind: "timeout" }), ms);
    p.then(
      (value) => {
        clearTimeout(t);
        resolve({ kind: "done", value });
      },
      (error) => {
        clearTimeout(t);
        resolve({ kind: "error", error });
      },
    );
  });
}

export async function executeJob(db: Database, job: Job, opts: ExecuteOptions = {}): Promise<{ ok: boolean; result?: unknown; error?: string; timedOut?: boolean }> {
  const timeoutMs = opts.timeoutMs ?? JOB_TIMEOUT_MS;
  const graceMs = opts.graceMs ?? ABORT_GRACE_MS;
  const orgId = job.organizationId ?? (await ensureDefaultOrganization(db)).id;
  const controller = new AbortController();
  const ctx: ServiceContext = { ...systemContext(orgId, db), signal: controller.signal };
  const started = Date.now();
  const [run] = await db.insert(automationRuns).values({ organizationId: orgId, jobId: job.id, automation: job.type, trigger: job.trigger, status: "running" }).returning({ id: automationRuns.id });
  const finishRun = (status: "succeeded" | "failed", extra: { summary?: Record<string, unknown>; error?: string }) =>
    db.update(automationRuns).set({ status, ...extra, durationMs: Date.now() - started, finishedAt: new Date() }).where(eq(automationRuns.id, run.id));
  const handler = (opts.handlers?.[job.type] ?? JOB_HANDLERS[job.type as keyof typeof JOB_HANDLERS]) as JobHandler | undefined;
  // Keep the lease alive while the handler runs; stops the moment we stop waiting for it.
  const heartbeat = job.lockedBy ? setInterval(() => void heartbeatJobs(db, job.lockedBy!, [job.id]).catch(() => undefined), opts.heartbeatMs ?? HEARTBEAT_MS) : null;
  try {
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    const work = Promise.resolve().then(() => handler(ctx, job.payload ?? {}));
    const outcome = await within(work, timeoutMs);

    if (outcome.kind === "timeout") {
      controller.abort(new JobTimeoutError(timeoutMs));
      const stopped = (await within(work, graceMs)).kind !== "timeout";
      const message = `Timed out after ${formatMs(timeoutMs)}; ${stopped ? "the handler stopped" : `the handler did not stop within ${formatMs(graceMs)} — any late result will be discarded`}. Not retried automatically: retry it manually from Admin → Logs → Jobs.`;
      await failJob(db, job, message, false);
      await finishRun("failed", { error: message });
      captureException(new JobTimeoutError(timeoutMs), { jobId: job.id, type: job.type, stopped });
      if (!stopped) {
        work.then(
          () => logger.warn("timed-out job finished late — result discarded", { jobId: job.id, type: job.type }),
          (err) => logger.warn("timed-out job failed late", { jobId: job.id, type: job.type, err }),
        );
      }
      return { ok: false, error: message, timedOut: true };
    }
    if (outcome.kind === "error") throw outcome.error;

    if (!(await completeJob(db, job, outcome.value))) {
      const message = "Lease lost before completion (the job was recovered or retried elsewhere) — result discarded";
      logger.warn(message, { jobId: job.id, type: job.type });
      await finishRun("failed", { error: message });
      return { ok: false, error: message };
    }
    await finishRun("succeeded", { summary: (outcome.value ?? {}) as Record<string, unknown> });
    logger.info("job succeeded", { jobId: job.id, type: job.type, ms: Date.now() - started });
    return { ok: true, result: outcome.value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = await failJob(db, job, message);
    await finishRun("failed", { error: message.slice(0, 4000) });
    captureException(err, { jobId: job.id, type: job.type, final });
    return { ok: false, error: message };
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

/** Runs queued jobs until the queue is empty (tests, CLI first-run, acceptance). */
export async function drainQueue(db: Database, opts: { maxJobs?: number; workerId?: string } = {}) {
  const results: Array<{ id: number; type: string; ok: boolean; error?: string }> = [];
  const max = opts.maxJobs ?? 200;
  while (results.length < max) {
    const [job] = await claimJobs(db, opts.workerId ?? `drain:${process.pid}`, 1);
    if (!job) break;
    const r = await executeJob(db, job);
    results.push({ id: job.id, type: job.type, ok: r.ok, error: r.error });
  }
  return results;
}

export class JobRunner {
  private active = 0;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private lastSchedule = 0;
  private lastRecovery = 0;
  readonly workerId: string;

  constructor(
    private db: Database,
    private opts: { concurrency?: number; pollMs?: number } = {},
  ) {
    this.workerId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 7)}`;
  }

  start() {
    this.stopped = false;
    logger.info("job runner started", { workerId: this.workerId, concurrency: this.opts.concurrency ?? 2 });
    this.schedule(500);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const deadline = Date.now() + 30_000;
    while (this.active > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    logger.info("job runner stopped", { workerId: this.workerId });
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async tick() {
    try {
      const now = Date.now();
      if (now - this.lastSchedule > 30_000) {
        this.lastSchedule = now;
        await enqueueDueSchedules(this.db);
      }
      if (now - this.lastRecovery > 60_000) {
        this.lastRecovery = now;
        const recovered = await recoverStaleJobs(this.db, STALE_LOCK_MS);
        if (recovered) logger.warn("recovered jobs from unresponsive workers", { recovered });
      }
      const capacity = (this.opts.concurrency ?? 2) - this.active;
      if (capacity > 0) {
        const jobs = await claimJobs(this.db, this.workerId, capacity);
        for (const job of jobs) {
          this.active++;
          void executeJob(this.db, job).finally(() => {
            this.active--;
          });
        }
      }
    } catch (err) {
      captureException(err, { component: "job-runner" });
    }
    this.schedule(this.active > 0 ? 1000 : (this.opts.pollMs ?? 2000));
  }
}
