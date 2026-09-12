import { CONTENT_STATUSES, PLATFORMS, type ContentStatus, type Platform } from "@/lib/constants";
import { apiRoute } from "@/server/auth/api";
import { listContent, trackingUrlFor } from "@/server/services/content";

export const dynamic = "force-dynamic";

/** GET /api/v1/content?productId=&status=&platform=&limit= — content items with their tracked URLs. */
export const GET = apiRoute({ permission: "content:read" }, async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const status = sp.get("status");
  const platform = sp.get("platform");
  const { items, total } = await listContent(ctx, {
    productId: sp.get("productId") ?? undefined,
    status: (CONTENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as ContentStatus) : undefined,
    platform: (PLATFORMS as readonly string[]).includes(platform ?? "") ? (platform as Platform) : undefined,
    limit: Math.min(Number(sp.get("limit") ?? 50), 200),
  });
  return { items: await Promise.all(items.map(async (c) => ({ ...c, trackingUrl: await trackingUrlFor(ctx, c) }))), total };
});
