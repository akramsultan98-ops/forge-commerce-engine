import { apiRoute, readJson } from "@/server/auth/api";
import { discoverAffiliateProducts } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

/** POST /api/v1/affiliate/discover — `{ network?, marketplace?, keywords, category?, limit?, page? }`: official-API search, ingested as DISCOVERED. */
export const POST = apiRoute({ permission: "affiliate:ingest" }, async (req, ctx) => discoverAffiliateProducts(ctx, await readJson(req)));
