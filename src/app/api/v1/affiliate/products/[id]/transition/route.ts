import { z } from "zod";
import { AFFILIATE_ACTIONS } from "@/domain/affiliate-products";
import { apiRoute, readJson } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { transitionAffiliateProduct } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(AFFILIATE_ACTIONS), note: z.string().trim().max(2000).optional(), revision: z.number().int().min(1).optional() });

/**
 * POST /api/v1/affiliate/products/{id}/transition — `{ action, note?, revision? }`. API keys may submit,
 * unpublish and archive (automation role) or also reject and restore (operator); approve and publish
 * need a signed-in person. A `revision` that no longer matches returns 409.
 */
export const POST = apiRoute<{ id: string }>({ permission: "affiliate:ingest" }, async (req, ctx, { id }) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("Invalid body", parsed.error.issues);
  return transitionAffiliateProduct(ctx, id, parsed.data.action, parsed.data.note, { expectedRevision: parsed.data.revision });
});
