"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { userContext } from "@/server/context";
import { audit } from "@/server/audit";
import { authenticateUser, countUsers, createUser } from "@/server/auth/core";
import { clientIp, endSession, startSession } from "@/server/auth/session";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { ensureDefaultOrganization } from "@/server/services/org";
import { makeT } from "@/i18n";
import { getLocale } from "@/i18n/server";
import { act, str, type ActionState } from "@/server/actions/util";

function safeNext(n: string): string {
  return n.startsWith("/admin") && !n.startsWith("//") && !n.includes("\\") ? n : "/admin/dashboard";
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const t = makeT(await getLocale());
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  const ip = await clientIp();
  const rl = rateLimit(`login:${ip ?? "?"}:${email}`, LIMITS.login.limit, LIMITS.login.windowMs);
  const rlIp = rateLimit(`login-ip:${ip ?? "?"}`, LIMITS.login.limit * 4, LIMITS.login.windowMs);
  if (!rl.ok || !rlIp.ok) return { ok: false, error: t("admin.login.rateLimited") };
  if (!email || !password) return { ok: false, error: t("admin.login.invalid") };
  const db = getDb();
  const user = await authenticateUser(db, email, password);
  if (!user) {
    const org = await ensureDefaultOrganization(db);
    await audit(userContext({ orgId: org.id, userId: "00000000-0000-0000-0000-000000000000", role: "viewer", ip, db }), "auth.login_failed", { type: "user" }, { email });
    return { ok: false, error: t("admin.login.invalid") };
  }
  await startSession(user.id);
  await audit(userContext({ orgId: user.organizationId, userId: user.id, role: user.role, ip, db }), "auth.login", { type: "user", id: user.id });
  redirect(safeNext(str(fd, "next")));
}

export async function setupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const db = getDb();
  const result = await act(async () => {
    if ((await countUsers(db)) > 0) throw new Error("Setup is already complete — sign in instead.");
    const org = await ensureDefaultOrganization(db);
    const user = await createUser(db, { organizationId: org.id, email: str(fd, "email"), name: str(fd, "name") || "Admin", password: str(fd, "password"), role: "admin" });
    await startSession(user.id);
    await audit(userContext({ orgId: org.id, userId: user.id, role: "admin", ip: await clientIp(), db }), "auth.setup_admin", { type: "user", id: user.id });
  });
  if (!result?.ok) return result?.error?.startsWith("Something went wrong") ? { ok: false, error: "Could not create the account — the password must be at least 10 characters and the email valid." } : result;
  redirect("/admin/dashboard");
}

export async function logoutAction() {
  await endSession();
  redirect("/admin/login");
}
