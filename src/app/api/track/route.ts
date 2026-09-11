// First-party tracking beacon (page/product views). Public by design; validated, rate-limited,
// bot-flagged, IP hashed. The visitor id is only read from the consent-gated httpOnly cookie.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { isDemoMode } from "@/server/env";
import { resolveStorefront } from "@/server/services/org";
import { recordEvent } from "@/server/services/tracking";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestIp } from "@/server/auth/api";

export const dynamic = "force-dynamic";

const uuid = z.string().uuid().optional().nullable();
const Beacon = z.object({
  type: z.enum(["PAGE_VIEW", "PRODUCT_VIEW", "PRODUCT_CLICK", "CHECKOUT"]),
  path: z.string().max(500).default("/"),
  productId: uuid,
  landingPageId: uuid,
  experimentId: uuid,
  variant: z.string().max(40).optional().nullable(),
  referrer: z.string().max(500).optional().nullable(),
  utm: z.record(z.string(), z.string().max(200)).optional(),
});

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (!rateLimit(`track:${ip ?? "?"}`, LIMITS.track.limit, LIMITS.track.windowMs).ok) return new NextResponse(null, { status: 204 });
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 8000) return new NextResponse(null, { status: 413 });
    raw = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = Beacon.safeParse(raw);
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const b = parsed.data;
  const db = getDb();
  const { org } = await resolveStorefront(db, req.headers.get("host"));
  const consent = req.cookies.get("forge_consent")?.value === "granted";
  await recordEvent(db, {
    orgId: org.id,
    // Product detail views count as page views for funnel math.
    eventType: b.type === "PRODUCT_VIEW" ? "PAGE_VIEW" : b.type,
    productId: b.productId ?? null,
    landingPageId: b.landingPageId ?? null,
    experimentId: b.experimentId ?? null,
    variant: b.variant ?? null,
    visitorId: consent ? (req.cookies.get("forge_vid")?.value ?? null) : null,
    utm: b.utm,
    referrer: b.referrer ?? null,
    path: b.path,
    country: req.headers.get("cf-ipcountry") ?? req.headers.get("x-vercel-ip-country") ?? null,
    ip,
    userAgent: req.headers.get("user-agent"),
    isDemo: isDemoMode(),
  });
  return new NextResponse(null, { status: 204 });
}
