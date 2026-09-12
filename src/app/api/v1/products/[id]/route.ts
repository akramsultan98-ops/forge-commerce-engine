import { apiRoute, readJson } from "@/server/auth/api";
import { deleteProduct, getProductWithRelations, updateProduct } from "@/server/services/products";
import { latestScore, scoreProductById } from "@/server/services/scoring";

export const dynamic = "force-dynamic";

export const GET = apiRoute<{ id: string }>({ permission: "products:read" }, async (_req, ctx, { id }) => {
  const { product, category, supplier } = await getProductWithRelations(ctx, id);
  return { product, category, supplier, score: await latestScore(ctx, id) };
});

export const PATCH = apiRoute<{ id: string }>({ permission: "products:write" }, async (req, ctx, { id }) => {
  const product = await updateProduct(ctx, id, await readJson(req), "MANUAL", ctx.actor === "api_key" ? "api" : "operator");
  const score = await scoreProductById(ctx, id);
  return { product, score: { overall: score.overall, confidence: score.confidence } };
});

export const DELETE = apiRoute<{ id: string }>({ permission: "products:delete" }, async (_req, ctx, { id }) => {
  await deleteProduct(ctx, id);
  return { deleted: true };
});
