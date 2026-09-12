import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { env } from "@/server/env";
import { AppError, captureException } from "@/server/errors";
import { completeShopifyOAuth } from "@/server/integrations/shopify";
import { userContext } from "@/server/context";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

/** Shopify OAuth redirect target: verifies HMAC + state, exchanges the code, stores the token encrypted. */
export async function GET(req: NextRequest) {
  const base = env().APP_URL;
  try {
    const db = getDb();
    const { orgId, shop } = await completeShopifyOAuth(db, req.nextUrl.searchParams);
    await audit(userContext({ orgId, userId: "00000000-0000-0000-0000-000000000000", role: "admin", actor: "system", db }), "shopify.connect", { type: "integration", id: "SHOPIFY" }, { shop });
    return NextResponse.redirect(new URL(`/admin/shopify?connected=${encodeURIComponent(shop)}`, base));
  } catch (err) {
    captureException(err, { route: "shopify-callback" });
    const message = err instanceof AppError ? err.message : "Could not complete the Shopify connection";
    return NextResponse.redirect(new URL(`/admin/shopify?error=${encodeURIComponent(message)}`, base));
  }
}
