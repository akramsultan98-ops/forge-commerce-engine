import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { AppError, captureException } from "@/server/errors";
import { completeShopifyOAuth, ensureShopifyWebhooks } from "@/server/integrations/shopify";
import { userContext } from "@/server/context";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

/** Shopify OAuth redirect target: verifies HMAC + state, exchanges the code, stores the token encrypted, registers webhooks. */
export async function GET(req: NextRequest) {
  const base = env().APP_URL;
  try {
    const db = getDb();
    const { orgId, shop } = await completeShopifyOAuth(db, req.nextUrl.searchParams);
    // Registration never fails the connection; its outcome is shown on /admin/shopify.
    const hooks = await ensureShopifyWebhooks(db, orgId);
    await audit(userContext({ orgId, userId: "00000000-0000-0000-0000-000000000000", role: "admin", actor: "system", db }), "shopify.connect", { type: "integration", id: "SHOPIFY" }, { shop, webhooksCreated: hooks.created.length, webhooksExisting: hooks.existing.length, webhookErrors: hooks.errors.length, webhooksSkipped: hooks.skipped ?? null });
    return NextResponse.redirect(new URL(`/admin/shopify?connected=${encodeURIComponent(shop)}`, base));
  } catch (err) {
    captureException(err, { route: "shopify-callback" });
    const message = err instanceof AppError ? err.message : "Could not complete the Shopify connection";
    return NextResponse.redirect(new URL(`/admin/shopify?error=${encodeURIComponent(message)}`, base));
  }
}
