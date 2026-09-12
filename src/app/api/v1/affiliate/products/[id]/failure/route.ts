import { apiRoute, readJson } from "@/server/auth/api";
import { reportAffiliateFailure } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

/** POST /api/v1/affiliate/products/{id}/failure — `{ code, message, unpublish? }`: record a problem an automation observed; optionally take the listing off the storefront. */
export const POST = apiRoute<{ id: string }>({ permission: "affiliate:ingest" }, async (req, ctx, { id }) => reportAffiliateFailure(ctx, id, await readJson(req)));
