import type { ServiceContext } from "./context";
import { auditLogs } from "./db/schema";
import { redact } from "./logging/logger";

/** Append-only audit trail for security-relevant and business-relevant mutations. */
export async function audit(
  ctx: ServiceContext,
  action: string,
  entity?: { type: string; id?: string | null },
  meta: Record<string, unknown> = {},
) {
  try {
    await ctx.db.insert(auditLogs).values({
      organizationId: ctx.orgId,
      userId: ctx.userId,
      actor: ctx.actor,
      action,
      entityType: entity?.type ?? null,
      entityId: entity?.id ?? null,
      meta: redact(meta) as Record<string, unknown>,
      ip: ctx.ip ?? null,
    });
  } catch (err) {
    ctx.log.error("failed to write audit log", { action, err });
  }
}
