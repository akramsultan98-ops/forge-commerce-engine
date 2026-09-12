// Shopify webhooks: HMAC-verified (raw body) against the app secret or a store-level webhook secret,
// routed to the organisation(s) connected to the sending store, de-duplicated by webhook id.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { webhookEvents } from "@/server/db/schema";
import { env } from "@/server/env";
import { captureException } from "@/server/errors";
import { handleShopifyWebhook, isValidShopDomain, matchWebhookSecret } from "@/server/integrations/shopify";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestIp } from "@/server/auth/api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!rateLimit(`webhook:${requestIp(req) ?? "?"}`, LIMITS.webhook.limit, LIMITS.webhook.windowMs).ok) return new NextResponse("rate limited", { status: 429 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return new NextResponse("payload too large", { status: 413 });
  const via = matchWebhookSecret(raw, req.headers.get("x-shopify-hmac-sha256"));
  if (!via) return new NextResponse("invalid signature", { status: 401 });
  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  const shop = (req.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
  if (!isValidShopDomain(shop)) return new NextResponse("invalid shop", { status: 400 });
  // A store-level secret authenticates exactly one store: the single-token SHOPIFY_SHOP_DOMAIN.
  if (via === "store" && shop !== env().SHOPIFY_SHOP_DOMAIN.toLowerCase()) return new NextResponse("invalid signature", { status: 401 });
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id") ?? `${topic}:${raw.length}:${Date.now()}`;
  const db = getDb();
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  const inserted = await db.insert(webhookEvents).values({ source: "shopify", externalId: webhookId, topic, payload: { shop, topic } }).onConflictDoNothing().returning({ id: webhookEvents.id });
  if (!inserted.length) return NextResponse.json({ duplicate: true });
  try {
    const result = await handleShopifyWebhook(db, topic, shop, payload, via);
    await db.update(webhookEvents).set({ status: "PROCESSED", processedAt: new Date(), payload: { shop, topic, result } }).where(eq(webhookEvents.id, inserted[0].id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, { webhook: "shopify", topic });
    // Free the idempotency slot so Shopify's retry is processed rather than reported as a duplicate.
    await db.delete(webhookEvents).where(eq(webhookEvents.id, inserted[0].id));
    return new NextResponse("processing failed", { status: 500 });
  }
}
