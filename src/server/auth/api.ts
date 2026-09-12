// Route-handler wrapper: authentication (session cookie or `Authorization: Bearer forge_…` API key),
// RBAC, rate limiting, consistent JSON errors and API request logging.

import { NextResponse, type NextRequest } from "next/server";
import { can, type Permission } from "@/lib/rbac";
import { getDb } from "../db/client";
import { apiRequestLogs } from "../db/schema";
import { env } from "../env";
import { userContext, type ServiceContext } from "../context";
import { captureException, ForbiddenError, RateLimitedError, toPublicError, UnauthorizedError } from "../errors";
import { hashIp } from "../security/crypto";
import { clientIpFromHeaders } from "../security/client-ip";
import { LIMITS, rateLimit } from "../security/rate-limit";
import { validateApiKey, validateSessionToken } from "./core";

/** Client IP: the TCP peer, or X-Forwarded-For only when the peer is a trusted proxy (TRUSTED_PROXIES). */
export function requestIp(req: NextRequest): string | null {
  return clientIpFromHeaders((name) => req.headers.get(name));
}

export async function authenticateRequest(req: NextRequest): Promise<ServiceContext | null> {
  const db = getDb();
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const key = await validateApiKey(db, auth.slice(7).trim());
    if (!key) return null;
    return userContext({ orgId: key.orgId, userId: "00000000-0000-0000-0000-000000000000", role: key.role, ip: requestIp(req), actor: "api_key", db });
  }
  const token = req.cookies.get("forge_session")?.value;
  if (!token) return null;
  const s = await validateSessionToken(db, token, env().SESSION_TTL_DAYS);
  if (!s) return null;
  return userContext({ orgId: s.user.organizationId, userId: s.user.id, role: s.user.role, ip: requestIp(req), db });
}

type Handler<P> = (req: NextRequest, ctx: ServiceContext, params: P) => Promise<unknown>;

export function apiRoute<P extends Record<string, string> = Record<string, string>>(opts: { permission?: Permission; limit?: keyof typeof LIMITS }, handler: Handler<P>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    const started = Date.now();
    let status = 200;
    let ctx: ServiceContext | null = null;
    try {
      const ip = requestIp(req);
      const lim = LIMITS[opts.limit ?? "api"];
      const rl = rateLimit(`${opts.limit ?? "api"}:${ip ?? "unknown"}`, lim.limit, lim.windowMs);
      if (!rl.ok) throw new RateLimitedError(rl.retryAfterSeconds);
      ctx = await authenticateRequest(req);
      if (!ctx) throw new UnauthorizedError();
      if (opts.permission && !can(ctx.role, opts.permission)) throw new ForbiddenError();
      // API keys act as the system actor for audit purposes.
      if (ctx.actor === "api_key") ctx = { ...ctx, userId: null };
      const result = await handler(req, ctx, await route.params);
      const res = result instanceof Response ? result : NextResponse.json({ data: result ?? null });
      status = res.status;
      return res;
    } catch (err) {
      const pub = toPublicError(err);
      status = pub.status;
      if (pub.status >= 500) captureException(err, { path: req.nextUrl.pathname, method: req.method });
      const headers: Record<string, string> = {};
      if (err instanceof RateLimitedError) headers["Retry-After"] = String(err.retryAfterSeconds);
      return NextResponse.json(pub.body, { status: pub.status, headers });
    } finally {
      const orgId = ctx?.orgId ?? null;
      const actor = ctx?.actor ?? "anonymous";
      void getDb()
        .insert(apiRequestLogs)
        .values({ organizationId: orgId, method: req.method, path: req.nextUrl.pathname.slice(0, 300), status, durationMs: Date.now() - started, actor, ipHash: hashIp(requestIp(req)) })
        .catch(() => undefined);
    }
  };
}

export async function readJson(req: NextRequest, maxBytes = 1_000_000): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ForbiddenError("Payload too large");
  try {
    return await req.json();
  } catch {
    return {};
  }
}
