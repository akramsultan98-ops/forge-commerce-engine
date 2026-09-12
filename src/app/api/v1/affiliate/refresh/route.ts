import { z } from "zod";
import { AFFILIATE_NETWORK_TYPES } from "@/lib/constants";
import { apiRoute, readJson } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { refreshAffiliateProducts } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

const Body = z.object({
  network: z.enum(AFFILIATE_NETWORK_TYPES).optional(),
  marketplace: z.string().max(60).optional(),
  olderThanHours: z.number().min(0).max(24).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

/**
 * POST /api/v1/affiliate/refresh — re-fetch listings older than `olderThanHours` (default 20 h; Amazon
 * allows at most 24 h). Without `network`, every configured provider is refreshed and unconfigured
 * ones are listed under `skipped`.
 */
export const POST = apiRoute({ permission: "affiliate:ingest" }, async (req, ctx) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("Invalid body", parsed.error.issues);
  return refreshAffiliateProducts(ctx, parsed.data);
});
