// Cron schedules (stored per organization, editable in /admin/logs → Automations).

import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { JobType } from "@/lib/constants";
import { isValidCron, nextCronDate } from "@/domain/cron";
import type { Database } from "../db/client";
import { jobSchedules } from "../db/schema";
import { ValidationError } from "../errors";
import { enqueueJob } from "./queue";

export const DEFAULT_SCHEDULES: Array<{ key: string; jobType: JobType; cron: string; description: string; payload?: Record<string, unknown> }> = [
  { key: "daily_link_check", jobType: "affiliate_link_check", cron: "30 4 * * *", description: "Daily: check affiliate links (alerts on breakage)" },
  { key: "daily_trend_refresh", jobType: "trend_refresh", cron: "0 5 * * *", description: "Daily: update trend signals" },
  { key: "daily_discovery", jobType: "product_discovery", cron: "0 6 * * *", description: "Daily: discover products" },
  { key: "daily_scoring", jobType: "product_scoring", cron: "30 6 * * *", description: "Daily: update product scores" },
  { key: "daily_recommendations", jobType: "recommendations_refresh", cron: "0 7 * * *", description: "Daily: generate product recommendations" },
  { key: "daily_top5", jobType: "report_generation", cron: "0 8 * * *", description: "Daily: Top 5 products-to-test report", payload: { type: "TOP5_DAILY" } },
  { key: "weekly_top5", jobType: "report_generation", cron: "0 8 * * 1", description: "Weekly (Mon): Top 5 report", payload: { type: "TOP5_WEEKLY" } },
  { key: "daily_test_evaluation", jobType: "test_evaluation", cron: "0 9 * * *", description: "Daily: evaluate running product tests" },
  { key: "hourly_analytics", jobType: "analytics_sync", cron: "15 * * * *", description: "Hourly: roll up analytics, detect spikes" },
  { key: "shopify_sync", jobType: "shopify_sync", cron: "0 */6 * * *", description: "Every 6h: sync Shopify orders (when connected)" },
];

export async function ensureDefaultSchedules(db: Database, orgId: string) {
  const now = new Date();
  for (const s of DEFAULT_SCHEDULES) {
    await db
      .insert(jobSchedules)
      .values({ organizationId: orgId, key: s.key, jobType: s.jobType, cron: s.cron, description: s.description, payload: s.payload ?? {}, nextRunAt: nextCronDate(s.cron, now) })
      .onConflictDoNothing();
  }
}

/** Enqueues every enabled schedule whose next run is due. Dedupe keys make this safe across workers. */
export async function enqueueDueSchedules(db: Database, now = new Date()) {
  const due = await db
    .select()
    .from(jobSchedules)
    .where(and(eq(jobSchedules.enabled, true), or(isNull(jobSchedules.nextRunAt), lte(jobSchedules.nextRunAt, now))));
  let enqueued = 0;
  for (const s of due) {
    const slot = (s.nextRunAt ?? now).toISOString();
    const r = await enqueueJob(db, { type: s.jobType as JobType, orgId: s.organizationId, payload: s.payload, trigger: "SCHEDULE", dedupeKey: `schedule:${s.id}:${slot}` });
    if (!r.deduped) enqueued++;
    await db.update(jobSchedules).set({ lastEnqueuedAt: now, nextRunAt: nextCronDate(s.cron, now) }).where(eq(jobSchedules.id, s.id));
  }
  return { due: due.length, enqueued };
}

export async function updateSchedule(db: Database, orgId: string, id: string, patch: { cron?: string; enabled?: boolean }) {
  if (patch.cron !== undefined && !isValidCron(patch.cron)) throw new ValidationError("Invalid cron expression (5 fields, UTC)");
  await db
    .update(jobSchedules)
    .set({ ...patch, ...(patch.cron ? { nextRunAt: nextCronDate(patch.cron) } : {}) })
    .where(and(eq(jobSchedules.id, id), eq(jobSchedules.organizationId, orgId)));
}
