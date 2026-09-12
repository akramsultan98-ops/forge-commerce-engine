import { z } from "zod";
import { apiRoute } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { affiliateFailures } from "@/server/services/affiliate-monitoring";

export const dynamic = "force-dynamic";

const Query = z.object({ expiringWithinHours: z.coerce.number().min(0).max(24).optional() });

/** GET /api/v1/affiliate/failures — refresh errors, expired/expiring storefront data, broken listing links, redirect fallbacks, unconfigured providers. */
export const GET = apiRoute({ permission: "affiliate:read" }, async (req, ctx) => {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query", parsed.error.issues);
  return affiliateFailures(ctx, parsed.data);
});
