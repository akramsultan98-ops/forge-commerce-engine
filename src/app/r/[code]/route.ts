// Tracked outbound redirect: /r/{code}?utm_… → logs the click (with attribution) → merchant/store.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { handleTrackedRedirect } from "@/server/services/tracking";
import { parseUtm } from "@/domain/utm";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestIp } from "@/server/auth/api";
import { captureException } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const ip = requestIp(req);
  const withinLimit = rateLimit(`redirect:${ip ?? "?"}`, LIMITS.redirect.limit, LIMITS.redirect.windowMs).ok;
  try {
    const consent = req.cookies.get("forge_consent")?.value === "granted";
    const result = await handleTrackedRedirect(getDb(), {
      code,
      utm: parseUtm(req.nextUrl.searchParams),
      visitorId: consent ? (req.cookies.get("forge_vid")?.value ?? null) : null,
      ip: withinLimit ? ip : null,
      userAgent: withinLimit ? req.headers.get("user-agent") : "rate-limited-bot",
      referrer: req.headers.get("referer"),
      country: req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? null,
      appUrl: env().APP_URL,
    });
    if (!result) return NextResponse.redirect(new URL("/products?link=unknown", env().APP_URL), 302);
    return NextResponse.redirect(result.destination, { status: 302, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch (err) {
    captureException(err, { route: "/r/[code]", code });
    return NextResponse.redirect(new URL("/products", env().APP_URL), 302);
  }
}
