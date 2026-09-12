import { z } from "zod";
import { apiRoute, readJson } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { getAffiliateProduct, updateAffiliateProduct } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

/** GET /api/v1/affiliate/products/{id} — one listing: freshness, allowed actions, publish blockers, storefront product and tracked link. */
export const GET = apiRoute<{ id: string }>({ permission: "affiliate:read" }, async (_req, ctx, { id }) => getAffiliateProduct(ctx, id));

const Body = z.object({ revision: z.number().int().min(1) }).passthrough();

/**
 * PATCH /api/v1/affiliate/products/{id} — edit FORGE-owned fields `{ revision, categoryId?, summary?,
 * problemSolved?, targetAudience?, tags?, expectedCommissionRate? }`. Network fields are refused;
 * automations may edit only before review; a stale `revision` returns 409.
 */
export const PATCH = apiRoute<{ id: string }>({ permission: "affiliate:ingest" }, async (req, ctx, { id }) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("Send the listing's current revision with the fields to change", parsed.error.issues);
  const { revision, ...fields } = parsed.data;
  return updateAffiliateProduct(ctx, id, fields, revision);
});
