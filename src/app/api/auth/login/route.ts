// JSON login for API clients and automated tests. Sets the same httpOnly session cookie as the form.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { authenticateUser, createSessionRecord } from "@/server/auth/core";
import { requestIp } from "@/server/auth/api";
import { env } from "@/server/env";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { userContext } from "@/server/context";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";
const Body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_error", message: "email and password are required" } }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  if (!rateLimit(`login:${ip ?? "?"}:${email}`, LIMITS.login.limit, LIMITS.login.windowMs).ok) {
    return NextResponse.json({ error: { code: "rate_limited", message: "Too many attempts" } }, { status: 429 });
  }
  const db = getDb();
  const user = await authenticateUser(db, email, parsed.data.password);
  if (!user) return NextResponse.json({ error: { code: "invalid_credentials", message: "Email or password is incorrect" } }, { status: 401 });
  const { token, expiresAt } = await createSessionRecord(db, user.id, env().SESSION_TTL_DAYS, { ip, userAgent: req.headers.get("user-agent") });
  await audit(userContext({ orgId: user.organizationId, userId: user.id, role: user.role, ip, db }), "auth.login", { type: "user", id: user.id }, { via: "api" });
  const res = NextResponse.json({ data: { id: user.id, email: user.email, name: user.name, role: user.role } });
  res.cookies.set("forge_session", token, { httpOnly: true, secure: env().APP_URL.startsWith("https://"), sameSite: "lax", path: "/", expires: expiresAt });
  return res;
}
