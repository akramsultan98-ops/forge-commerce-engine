import { z } from "zod";
import { AFFILIATE_NETWORK_TYPES, AFFILIATE_PRODUCT_STATUSES } from "@/lib/constants";
import { apiRoute, readJson } from "@/server/auth/api";
import { ValidationError } from "@/server/errors";
import { ingestAffiliateProducts, listAffiliateProducts } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

const bool = z.enum(["true", "false"]).optional();
const Query = z.object({
  status: z.enum(AFFILIATE_PRODUCT_STATUSES).optional(),
  network: z.enum(AFFILIATE_NETWORK_TYPES).optional(),
  marketplace: z.string().max(60).optional(),
  stale: bool,
  hasError: bool,
  q: z.string().max(100).optional(),
  updatedSince: z.coerce.date().optional(),
  sort: z.enum(["updated", "score", "fetched"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const toBool = (v: "true" | "false" | undefined) => (v === undefined ? undefined : v === "true");

/** GET /api/v1/affiliate/products — the review queue / catalogue of network listings (with `total` for paging). */
export const GET = apiRoute({ permission: "affiliate:read" }, async (req, ctx) => {
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ValidationError("Invalid query", parsed.error.issues);
  const { stale, hasError, ...rest } = parsed.data;
  return listAffiliateProducts(ctx, { ...rest, stale: toBool(stale), hasError: toBool(hasError) });
});

const Body = z.object({ items: z.array(z.unknown()).min(1).max(100), source: z.enum(["n8n", "api", "manual"]).default("api") });

/** POST /api/v1/affiliate/products — send listings into FORGE (e.g. from n8n). Upserts; new listings start as DISCOVERED. */
export const POST = apiRoute({ permission: "affiliate:ingest" }, async (req, ctx) => {
  const parsed = Body.safeParse(await readJson(req, 2_000_000));
  if (!parsed.success) throw new ValidationError("Invalid body", parsed.error.issues);
  return ingestAffiliateProducts(ctx, parsed.data.items, { source: parsed.data.source, provenance: "MANUAL" });
});
