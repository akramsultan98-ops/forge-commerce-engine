// Worker: polls the queue, executes handlers with a timeout, records automation runs,
// enqueues due cron schedules and recovers jobs orphaned by crashed workers.

import os from "node:os";
import { eq } from "drizzle-orm";
import type { JobType } from "@/lib/constants";
import { systemContext } from "../context";
import type { Database } from "../db/client";
import { automationRuns, type Job } from "../db/schema";
import { captureException } from "../errors";
import { logger } from "../logging/logger";
import { ensureDefaultOrganization } from "../services/org";
import { claimJobs, completeJob, failJob, recoverStaleJobs } from "./queue";
import { JOB_HANDLERS } from "./handlers";
import { enqueueDueSchedules } from "./scheduler";

const JOB_TIMEOUT_MS = 20 * 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Job exceeded ${ms / 60_000} minute timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function executeJob(db: Database, job: Job): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const orgId = job.organizationId ?? (await ensureDefaultOrganization(db)).id;
  const ctx = systemContext(orgId, db);
  const started = Date.now();
  const [run] = await db.insert(automationRuns).values({ organizationId: orgId, jobId: job.id, automation: job.type, trigger: job.trigger, status: "running" }).returning({ id: automationRuns.id });
  const handler = JOB_HANDLERS[job.type as JobType];
  try {
    if (!handler) throw new Error(`No handler for job type "${job.type}"`);
    const result = await withTimeout(handler(ctx, job.payload ?? {}), JOB_TIMEOUT_MS);
    await completeJob(db, job.id, result);
    await db.update(automationRuns).set({ status: "succeeded", summary: (result ?? {}) as Record<string, unknown>, durationMs: Date.now() - started, finishedAt: new Date() }).where(eq(automationRuns.id, run.id));
    logger.info("job succeeded", { jobId: job.id, type: job.type, ms: Date.now() - started });
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const final = await failJob(db, job, message);
    await db.update(automationRuns).set({ status: "failed", error: message.slice(0, 4000), durationMs: Date.now() - started, finishedAt: new Date() }).where(eq(automationRuns.id, run.id));
    captureException(err, { jobId: job.id, type: job.type, final });
    return { ok: false, error: message };
  }
}

/** Runs queued jobs until the queue is empty (tests, CLI first-run, acceptance). */
export async function drainQueue(db: Database, opts: { maxJobs?: number; workerId?: string } = {}) {
  const results: Array<{ id: number; type: string; ok: boolean; error?: string }> = [];
  const max = opts.maxJobs ?? 200;
  while (results.length < max) {
    const [job] = await claimJobs(db, opts.workerId ?? "drain", 1);
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
      if (now - this.lastRecovery > 5 * 60_000) {
        this.lastRecovery = now;
        const recovered = await recoverStaleJobs(this.db, JOB_TIMEOUT_MS + 60_000);
        if (recovered) logger.warn("recovered stale jobs", { recovered });
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
