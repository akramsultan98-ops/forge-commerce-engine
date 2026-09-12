import { apiRoute, readJson } from "@/server/auth/api";
import { scoreAffiliateProduct } from "@/server/services/affiliate-products";

export const dynamic = "force-dynamic";

/** POST /api/v1/affiliate/products/{id}/score — `{ score 0–100, provenance: AI_INFERENCE|ESTIMATED|MANUAL, source, reasons? }`. */
export const POST = apiRoute<{ id: string }>({ permission: "affiliate:ingest" }, async (req, ctx, { id }) => scoreAffiliateProduct(ctx, id, await readJson(req)));
