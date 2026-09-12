import { z } from "zod";
import { AFFILIATE_NETWORK_TYPES } from "@/lib/constants";
import { apiRoute } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { affiliateTracking } from "@/server/services/affiliate-monitoring";

export const dynamic = "force-dynamic";

const Query = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  network: z.enum(AFFILIATE_NETWORK_TYPES).optional(),
  id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** GET /api/v1/affiliate/tracking?days=&network=&id= — per listing: views, outbound clicks, redirect fallbacks, CTR, reported conversions and commission (per currency). */
export const GET = apiRoute({ permission: "affiliate:read" }, async (req, ctx) => {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query", parsed.error.issues);
  const { id, ...rest } = parsed.data;
  return affiliateTracking(ctx, { ...rest, affiliateProductId: id });
});
