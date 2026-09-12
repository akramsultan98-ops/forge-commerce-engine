import { apiRoute, readJson } from "@/server/auth/api";
import { createLink, listLinks, trackedUrl } from "@/server/services/affiliate";

export const dynamic = "force-dynamic";

/** GET /api/v1/affiliate-links?productId= */
export const GET = apiRoute({ permission: "affiliate:read" }, async (req, ctx) => {
  const rows = await listLinks(ctx, { productId: req.nextUrl.searchParams.get("productId") ?? undefined });
  return rows.map((r) => ({ ...r.link, trackedUrl: trackedUrl(r.link.code), productTitle: r.productTitle, networkName: r.networkName }));
});

/** POST /api/v1/affiliate-links — { productId, url, networkId?, merchant?, commissionRate?, cookieDays?, country?, isPrimary? } */
export const POST = apiRoute({ permission: "affiliate:write" }, async (req, ctx) => {
  const link = await createLink(ctx, await readJson(req));
  return { ...link, trackedUrl: trackedUrl(link.code) };
});
