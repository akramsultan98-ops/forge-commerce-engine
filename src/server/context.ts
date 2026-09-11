import type { UserRole } from "@/lib/constants";
import { can, type Permission } from "@/lib/rbac";
import { getDb, type Database } from "./db/client";
import { ForbiddenError } from "./errors";
import { createLogger, type Logger } from "./logging/logger";

/** Everything a service needs: database, tenant, actor and a scoped logger. */
export interface ServiceContext {
  db: Database;
  orgId: string;
  userId: string | null;
  role: UserRole;
  actor: "user" | "system" | "api_key" | "agent";
  ip?: string | null;
  log: Logger;
}

export function systemContext(orgId: string, db: Database = getDb()): ServiceContext {
  return { db, orgId, userId: null, role: "admin", actor: "system", log: createLogger({ orgId, actor: "system" }) };
}

export function userContext(opts: { orgId: string; userId: string; role: UserRole; ip?: string | null; actor?: ServiceContext["actor"]; db?: Database }): ServiceContext {
  return {
    db: opts.db ?? getDb(),
    orgId: opts.orgId,
    userId: opts.userId,
    role: opts.role,
    actor: opts.actor ?? "user",
    ip: opts.ip ?? null,
    log: createLogger({ orgId: opts.orgId, userId: opts.userId }),
  };
}

export function assertCan(ctx: ServiceContext, permission: Permission) {
  if (!can(ctx.role, permission)) throw new ForbiddenError(`Your role (${ctx.role}) cannot ${permission.replace(":", " ")}`);
}
