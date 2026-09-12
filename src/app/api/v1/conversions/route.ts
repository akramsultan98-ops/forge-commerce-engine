import { z } from "zod";
import { apiRoute, readJson } from "@/server/auth/api";
import { audit } from "@/server/audit";
import { ValidationError } from "@/server/errors";
import { getProduct } from "@/server/services/products";
import { recordConversion } from "@/server/services/tracking";

export const dynamic = "force-dynamic";

const Body = z.object({
  productId: z.string().uuid(),
  externalId: z.string().min(1).max(200),
  source: z.string().regex(/^[a-z0-9_-]{2,40}$/).default("manual"),
  clickId: z.string().uuid().optional(),
  revenue: z.number().min(0).max(1_000_000),
  commission: z.number().min(0).max(1_000_000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  occurredAt: z.coerce.date().optional(),
});

/** POST /api/v1/conversions — record a conversion from a report/export (provenance MANUAL; idempotent on source + externalId). */
export const POST = apiRoute({ permission: "affiliate:write" }, async (req, ctx) => {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) throw new ValidationError("Invalid conversion", parsed.error.issues);
  const b = parsed.data;
  const product = await getProduct(ctx, b.productId);
  const r = await recordConversion(ctx.db, { orgId: ctx.orgId, source: b.source, externalId: b.externalId, clickId: b.clickId ?? null, productId: product.id, revenue: b.revenue, commission: b.commission, currency: b.currency, occurredAt: b.occurredAt, provenance: "MANUAL", isDemo: product.isDemo });
  if (r.created) await audit(ctx, "conversion.record", { type: "conversion", id: r.id }, { source: b.source, externalId: b.externalId });
  return r;
});
