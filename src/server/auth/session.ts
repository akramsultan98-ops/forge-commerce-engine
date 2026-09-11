import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission } from "@/lib/rbac";
import { getDb } from "../db/client";
import { env } from "../env";
import { userContext, type ServiceContext } from "../context";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { createSessionRecord, revokeSession, validateSessionToken, type SessionUser } from "./core";

export const SESSION_COOKIE = "forge_session";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

function cookieSecure(): boolean {
  return env().APP_URL.startsWith("https://") || env().NODE_ENV === "production";
}

export async function startSession(userId: string) {
  const h = await headers();
  const { token, expiresAt } = await createSessionRecord(getDb(), userId, env().SESSION_TTL_DAYS, { ip: await clientIp(), userAgent: h.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", expires: expiresAt });
}

export const getSession = cache(async (): Promise<{ user: SessionUser } | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await validateSessionToken(getDb(), token, env().SESSION_TTL_DAYS);
  return s ? { user: s.user } : null;
});

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(getDb(), token);
  store.delete(SESSION_COOKIE);
}

/** For pages: redirects to login (or back to the dashboard when the role lacks permission). */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/admin/login");
  if (permission && !can(s.user.role, permission)) redirect("/admin/dashboard?denied=1");
  return s.user;
}

/** For server actions: throws instead of redirecting so the form can show the error. */
export async function actionContext(permission?: Permission): Promise<ServiceContext> {
  const s = await getSession();
  if (!s) throw new UnauthorizedError();
  if (permission && !can(s.user.role, permission)) throw new ForbiddenError(`Your role (${s.user.role}) cannot ${permission.replace(":", " ")}`);
  return userContext({ orgId: s.user.organizationId, userId: s.user.id, role: s.user.role, ip: await clientIp() });
}

/** Read-only context for server components. */
export async function pageContext(permission?: Permission): Promise<ServiceContext & { user: SessionUser }> {
  const user = await requireUser(permission);
  return { ...userContext({ orgId: user.organizationId, userId: user.id, role: user.role, ip: await clientIp() }), user };
}
