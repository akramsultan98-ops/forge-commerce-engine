import { apiRoute } from "@/server/auth/api";
import { importCsv } from "@/server/discovery/service";
import { ValidationError } from "@/server/errors";

export const dynamic = "force-dynamic";

/** POST /api/v1/products/import — body: text/csv, or multipart with a `file` field. Max 5 MB. */
export const POST = apiRoute({ permission: "products:write" }, async (req, ctx) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 5_500_000) throw new ValidationError("CSV must be 5 MB or smaller");
  const type = req.headers.get("content-type") ?? "";
  let text = "";
  if (type.startsWith("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!file || typeof file === "string") throw new ValidationError("Missing `file`");
    if (file.size > 5_000_000) throw new ValidationError("CSV must be 5 MB or smaller");
    text = await file.text();
  } else if (type.startsWith("text/csv") || type.startsWith("text/plain")) {
    text = await req.text();
  } else {
    throw new ValidationError("Send text/csv or multipart/form-data");
  }
  const model = req.nextUrl.searchParams.get("model");
  return importCsv(ctx, text, { defaultBusinessModel: model === "DROPSHIPPING" || model === "SHOPIFY" || model === "LANDING_PAGE" ? model : "AFFILIATE" });
});
