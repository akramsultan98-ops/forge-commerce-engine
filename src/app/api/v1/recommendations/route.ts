import { apiRoute } from "@/server/auth/api";
import { listRecommendations } from "@/server/services/recommendations";

export const dynamic = "force-dynamic";

/** GET /api/v1/recommendations?status=OPEN|DONE|DISMISSED&productId= */
export const GET = apiRoute({ permission: "dashboard:read" }, async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const rows = await listRecommendations(ctx, { status: status === "DONE" || status === "DISMISSED" ? status : "OPEN", productId: sp.get("productId") ?? undefined, limit: 100 });
  return rows.map((r) => ({ ...r.rec, productTitle: r.productTitle }));
});
