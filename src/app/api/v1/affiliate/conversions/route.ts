import { z } from "zod";
import { apiRoute, readJson } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { importListingConversions } from "@/server/services/affiliate-monitoring";

export const dynamic = "force-dynamic";

const Body = z.object({ source: z.string().optional(), items: z.array(z.unknown()).min(1).max(500) });

/**
 * POST /api/v1/affiliate/conversions — `{ source?, items: [{ network, marketplace, externalId, orderId,
 * occurredAt, revenue, commission, currency, clickId? }] }`: conversions a network reported (e.g. an
 * Amazon Associates earnings report), stored as reported (MANUAL provenance), idempotent on source + orderId.
 */
export const POST = apiRoute({ permission: "affiliate:ingest" }, async (req, ctx) => {
  const parsed = Body.safeParse(await readJson(req, 2_000_000));
  if (!parsed.success) throw new ValidationError("Invalid body", parsed.error.issues);
  return importListingConversions(ctx, parsed.data);
});
