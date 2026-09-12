// Shopify webhooks: HMAC-verified (raw body), de-duplicated by webhook id, then handled.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { webhookEvents } from "@/server/db/schema";
import { env } from "@/server/env";
import { captureException } from "@/server/errors";
import { handleShopifyWebhook, isValidShopDomain, verifyShopifyWebhook } from "@/server/integrations/shopify";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requestIp } from "@/server/auth/api";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!rateLimit(`webhook:${requestIp(req) ?? "?"}`, LIMITS.webhook.limit, LIMITS.webhook.windowMs).ok) return new NextResponse("rate limited", { status: 429 });
  const raw = await req.text();
  if (raw.length > 2_000_000) return new NextResponse("payload too large", { status: 413 });
  const secret = env().SHOPIFY_CLIENT_SECRET;
  if (!secret || !verifyShopifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), secret)) return new NextResponse("invalid signature", { status: 401 });
  const topic = req.headers.get("x-shopify-topic") ?? "unknown";
  const shop = req.headers.get("x-shopify-shop-domain") ?? "";
  const webhookId = req.headers.get("x-shopify-webhook-id") ?? req.headers.get("x-shopify-event-id") ?? `${topic}:${raw.length}:${Date.now()}`;
  if (!isValidShopDomain(shop)) return new NextResponse("invalid shop", { status: 400 });
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
    const result = await handleShopifyWebhook(db, topic, shop, payload);
    await db.update(webhookEvents).set({ status: "PROCESSED", processedAt: new Date(), payload: { shop, topic, result } }).where(eq(webhookEvents.id, inserted[0].id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, { webhook: "shopify", topic });
    await db.update(webhookEvents).set({ status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "error" }).where(eq(webhookEvents.id, inserted[0].id));
    // 500 lets Shopify retry with backoff.
    return new NextResponse("processing failed", { status: 500 });
  }
}
