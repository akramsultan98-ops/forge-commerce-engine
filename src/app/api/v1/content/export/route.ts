import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiRoute } from "@/server/auth/api";
import { content } from "@/server/db/schema";
import { exportContentPackage } from "@/server/services/content";

export const dynamic = "force-dynamic";

const TYPES = { json: "application/json", csv: "text/csv", markdown: "text/markdown" } as const;

/** GET /api/v1/content/export?productId=…|ids=a,b&format=json|csv|markdown — ready-to-publish content package. */
export const GET = apiRoute({ permission: "content:read" }, async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  const format = (Object.keys(TYPES).includes(sp.get("format") ?? "") ? sp.get("format") : "markdown") as keyof typeof TYPES;
  let ids = (sp.get("ids") ?? "")
    .split(",")
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 500);
  const productId = sp.get("productId");
  if (!ids.length && productId && /^[0-9a-f-]{36}$/i.test(productId)) {
    ids = (await ctx.db.select({ id: content.id }).from(content).where(and(eq(content.organizationId, ctx.orgId), eq(content.productId, productId)))).map((r) => r.id);
  }
  const body = await exportContentPackage(ctx, ids, format);
  const ext = format === "markdown" ? "md" : format;
  return new NextResponse(body, {
    headers: {
      "Content-Type": `${TYPES[format]}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="forge-content-${new Date().toISOString().slice(0, 10)}.${ext}"`,
      "Cache-Control": "no-store",
    },
  });
});
