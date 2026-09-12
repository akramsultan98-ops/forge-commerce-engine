import { PRODUCT_STATUSES, type ProductStatus } from "@/lib/constants";
import { apiRoute, readJson } from "@/server/auth/api";
import { createProduct, listProducts } from "@/server/services/products";
import { scoreProductById } from "@/server/services/scoring";

export const dynamic = "force-dynamic";

/** GET /api/v1/products?status=&q=&maxPrice=&minScore=&sort=&limit=&offset= */
export const GET = apiRoute({ permission: "products:read" }, async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const statuses = (sp.get("status") ?? "")
    .split(",")
    .filter((s): s is ProductStatus => (PRODUCT_STATUSES as readonly string[]).includes(s));
  const num = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const r = await listProducts(ctx, {
    status: statuses.length ? statuses : undefined,
    q: sp.get("q") ?? undefined,
    maxPrice: num("maxPrice"),
    minScore: num("minScore"),
    businessModel: sp.get("model") ?? undefined,
    sort: (["score", "recent", "price", "title"].includes(sp.get("sort") ?? "") ? sp.get("sort") : "score") as "score",
    limit: Math.min(num("limit") ?? 50, 200),
    offset: num("offset") ?? 0,
  });
  return { items: r.items.map(({ fieldProvenance, ...p }) => ({ ...p, provenance: fieldProvenance })), total: r.total };
});

/** POST /api/v1/products — creates a product (provenance MANUAL) and scores it. */
export const POST = apiRoute({ permission: "products:write" }, async (req, ctx) => {
  const body = await readJson(req);
  const p = await createProduct(ctx, body, { provenance: "MANUAL", source: "MANUAL_IMPORT", sourceLabel: ctx.actor === "api_key" ? "api" : "operator" });
  const score = await scoreProductById(ctx, p.id);
  return { product: p, score: { overall: score.overall, confidence: score.confidence, reasons: score.reasons, warnings: score.warnings } };
});
