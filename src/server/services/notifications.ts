import { and, count, desc, eq, gte, isNull, or } from "drizzle-orm";
import type { NotificationType, Severity } from "@/lib/constants";
import type { ServiceContext } from "../context";
import { notifications } from "../db/schema";
import { isDemoMode } from "../env";
import { getSetting } from "../settings";
import { sendEmail, emailConfigured } from "../integrations/email";
import { sendTelegram, telegramConfigured } from "../integrations/telegram";

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  severity?: Severity;
  entity?: { type: string; id: string };
  userId?: string | null;
  /** De-duplicates identical alerts inside this window (default 20h). */
  dedupeHours?: number;
}

export async function notify(ctx: ServiceContext, input: NotifyInput) {
  const since = new Date(Date.now() - (input.dedupeHours ?? 20) * 3600_000);
  if (input.entity) {
    const [dup] = await ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.organizationId, ctx.orgId), eq(notifications.type, input.type), eq(notifications.entityId, input.entity.id), gte(notifications.createdAt, since)))
      .limit(1);
    if (dup) return dup.id;
  }
  const prefs = await getSetting(ctx, "notifications");
  const channels = ["DASHBOARD", ...(prefs.email ? ["EMAIL"] : []), ...(prefs.telegram ? ["TELEGRAM"] : [])];
  const [row] = await ctx.db
    .insert(notifications)
    .values({
      organizationId: ctx.orgId,
      userId: input.userId ?? null,
      type: input.type,
      severity: input.severity ?? "info",
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 2000),
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      channels,
      delivery: { DASHBOARD: "delivered" },
    })
    .returning({ id: notifications.id });
  if (channels.length > 1) {
    const { enqueueJob } = await import("../jobs/queue");
    await enqueueJob(ctx.db, { type: "notification_dispatch", orgId: ctx.orgId, payload: { notificationId: row.id }, trigger: "EVENT", maxAttempts: 4 });
  }
  return row.id;
}

/** Delivers a notification to external channels. DEMO_MODE suppresses every external send. */
export async function dispatchNotification(ctx: ServiceContext, id: string) {
  const [n] = await ctx.db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.organizationId, ctx.orgId))).limit(1);
  if (!n) return { skipped: "missing" };
  const prefs = await getSetting(ctx, "notifications");
  const delivery: Record<string, string> = { ...n.delivery };
  const text = `${n.title}\n\n${n.body}`;
  for (const channel of n.channels) {
    if (channel === "DASHBOARD" || delivery[channel] === "sent") continue;
    if (isDemoMode()) {
      delivery[channel] = "suppressed_demo";
      continue;
    }
    try {
      if (channel === "EMAIL") {
        if (!emailConfigured()) delivery[channel] = "not_configured";
        else {
          await sendEmail({ to: prefs.emailTo || undefined, subject: `[FORGE] ${n.title}`, text });
          delivery[channel] = "sent";
        }
      } else if (channel === "TELEGRAM") {
        if (!telegramConfigured()) delivery[channel] = "not_configured";
        else {
          await sendTelegram(text);
          delivery[channel] = "sent";
        }
      }
    } catch (err) {
      delivery[channel] = `failed: ${err instanceof Error ? err.message.slice(0, 120) : "error"}`;
    }
  }
  await ctx.db.update(notifications).set({ delivery }).where(eq(notifications.id, id));
  const failed = Object.values(delivery).some((v) => v.startsWith("failed"));
  if (failed) throw new Error(`Notification delivery failed: ${JSON.stringify(delivery)}`);
  return delivery;
}

export async function listNotifications(ctx: Pick<ServiceContext, "db" | "orgId" | "userId">, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  return ctx.db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, ctx.orgId), or(isNull(notifications.userId), ctx.userId ? eq(notifications.userId, ctx.userId) : undefined), opts.unreadOnly ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit ?? 50);
}

export async function unreadCount(ctx: Pick<ServiceContext, "db" | "orgId">) {
  const [r] = await ctx.db.select({ n: count() }).from(notifications).where(and(eq(notifications.organizationId, ctx.orgId), isNull(notifications.readAt)));
  return Number(r?.n ?? 0);
}

export async function markRead(ctx: ServiceContext, id?: string) {
  await ctx.db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.organizationId, ctx.orgId), isNull(notifications.readAt), id ? eq(notifications.id, id) : undefined));
}
