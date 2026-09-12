// Affiliate conversion postbacks: /api/webhooks/affiliate/{network}?token=…&click_id=…&order_id=…&amount=…&commission=…&currency=…
// The token is the network's postback secret (constant-time compared). Idempotent on order id.

import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { webhookEvents } from "@/server/db/schema";
import { captureException } from "@/server/errors";
import { verifyPostbackToken } from "@/server/services/affiliate";
import { recordConversion } from "@/server/services/tracking";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestIp } from "@/server/auth/api";

export const dynamic = "force-dynamic";

const unresolved = (v: string | null) => !v || /^[{[!]/.test(v); // macro the network didn't substitute
const num = (v: string | null) => {
  if (unresolved(v)) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

async function handle(req: NextRequest, network: string) {
  if (!rateLimit(`webhook:${requestIp(req) ?? "?"}`, LIMITS.webhook.limit, LIMITS.webhook.windowMs).ok) return new NextResponse("rate limited", { status: 429 });
  const params = new URLSearchParams(req.nextUrl.searchParams);
  if (req.method === "POST" && (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    for (const [k, v] of new URLSearchParams(await req.text())) if (!params.has(k)) params.set(k, v);
  }
  const token = params.get("token") ?? "";
  if (!/^[a-z0-9_-]{1,60}$/.test(network) || !token) return new NextResponse("unauthorized", { status: 401 });
  const db = getDb();
  const net = await verifyPostbackToken(db, network, token);
  if (!net) return new NextResponse("unauthorized", { status: 401 });
  const orderId = params.get("order_id");
  if (unresolved(orderId)) return new NextResponse("missing order_id", { status: 400 });
  const currency = unresolved(params.get("currency")) ? "USD" : String(params.get("currency")).slice(0, 3).toUpperCase();
  try {
    const clickId = params.get("click_id");
    const r = await recordConversion(db, {
      orgId: net.organizationId,
      source: net.slug,
      externalId: orderId!,
      clickId: unresolved(clickId) ? null : clickId,
      networkId: net.id,
      revenue: num(params.get("amount")),
      commission: num(params.get("commission")),
      currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
      provenance: "REAL",
      isDemo: net.isDemo,
    });
    await db.insert(webhookEvents).values({ source: `affiliate:${net.slug}`, externalId: orderId!, topic: "conversion", organizationId: net.organizationId, payload: { conversionId: r.id, created: r.created }, status: "PROCESSED", processedAt: new Date() }).onConflictDoNothing();
    return new NextResponse(r.created ? "OK" : "OK (duplicate)", { status: 200 });
  } catch (err) {
    captureException(err, { webhook: "affiliate", network });
    return new NextResponse("error", { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  return handle(req, (await params).network);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ network: string }> }) {
  return handle(req, (await params).network);
}
