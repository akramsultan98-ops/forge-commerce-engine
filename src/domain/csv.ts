// RFC 4180 CSV parsing + product feed mapping for the Manual Import adapter.

import { z } from "zod";
import { BUSINESS_MODELS } from "@/lib/constants";

export function parseCsv(text: string, maxRows = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > maxRows) throw new Error(`CSV exceeds the ${maxRows}-row limit`);
    } else field += ch;
  }
  if (inQuotes) throw new Error("CSV has an unterminated quoted field");
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const ALIASES: Record<string, string[]> = {
  title: ["title", "name", "product_title", "product_name", "product"],
  description: ["description", "desc", "body", "body_html"],
  category: ["category", "product_type", "type", "category_name"],
  brand: ["brand", "vendor", "manufacturer"],
  supplier: ["supplier", "supplier_name", "source"],
  supplierUrl: ["supplier_url", "supplier_link"],
  productUrl: ["product_url", "url", "link", "merchant_url"],
  affiliateUrl: ["affiliate_url", "affiliate_link", "deep_link", "tracking_url"],
  imageUrl: ["image_url", "image", "image_link", "img"],
  sourceProductId: ["source_product_id", "sku", "product_id", "id", "asin"],
  currency: ["currency"],
  cost: ["cost", "supplier_cost", "wholesale", "cogs", "unit_cost"],
  sellingPrice: ["selling_price", "price", "retail_price", "sale_price"],
  shippingCost: ["shipping_cost", "shipping"],
  shippingDaysMin: ["shipping_days_min", "ship_min"],
  shippingDaysMax: ["shipping_days_max", "shipping_days", "ship_max", "delivery_days"],
  commissionPercentage: ["commission_percentage", "commission_pct", "commission_rate", "commission"],
  affiliateCommission: ["affiliate_commission", "commission_amount", "flat_commission"],
  rating: ["rating", "stars", "avg_rating"],
  reviewCount: ["review_count", "reviews", "num_reviews"],
  estimatedSales: ["estimated_sales", "monthly_sales", "sales_30d"],
  countriesAvailable: ["countries", "countries_available", "ship_to"],
  tags: ["tags", "keywords"],
  trendKeyword: ["trend_keyword", "wikipedia_article"],
  businessModel: ["business_model", "model"],
};

const num = z.preprocess((v) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/[$€£,\s%]/g, "").trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : v;
}, z.number().nonnegative().optional());

const int = z.preprocess((v) => {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : v;
}, z.number().int().nonnegative().optional());

const url = z
  .string()
  .trim()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL")
  .optional();

const list = z.preprocess(
  (v) =>
    typeof v === "string"
      ? v
          .split(/[|;,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : v,
  z.array(z.string().max(80)).max(50).optional(),
);

export const ImportRowSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional(),
  category: z.string().trim().max(80).optional(),
  brand: z.string().trim().max(120).optional(),
  supplier: z.string().trim().max(120).optional(),
  supplierUrl: url,
  productUrl: url,
  affiliateUrl: url,
  imageUrl: url,
  sourceProductId: z.string().trim().max(120).optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  cost: num,
  sellingPrice: num,
  shippingCost: num,
  shippingDaysMin: int,
  shippingDaysMax: int,
  commissionPercentage: z.preprocess((v) => v, num).refine((v) => v === undefined || v <= 100, "must be ≤ 100"),
  affiliateCommission: num,
  rating: num.refine((v) => v === undefined || v <= 5, "must be ≤ 5"),
  reviewCount: int,
  estimatedSales: int,
  countriesAvailable: list,
  tags: list,
  trendKeyword: z.string().trim().max(200).optional(),
  businessModel: z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim().toUpperCase() : undefined), z.enum(BUSINESS_MODELS).optional()),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export interface CsvImportResult {
  rows: ImportRow[];
  errors: Array<{ line: number; message: string }>;
  unknownColumns: string[];
}

export function mapProductCsv(text: string, maxRows = 2000): CsvImportResult {
  const table = parseCsv(text, maxRows);
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: "CSV needs a header row and at least one data row" }], unknownColumns: [] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const colFor: Record<number, string> = {};
  const unknown: string[] = [];
  header.forEach((h, idx) => {
    const key = Object.entries(ALIASES).find(([, names]) => names.includes(h))?.[0];
    if (key && !Object.values(colFor).includes(key)) colFor[idx] = key;
    else if (!key) unknown.push(h);
  });
  if (!Object.values(colFor).includes("title")) return { rows: [], errors: [{ line: 1, message: "Missing a title/name column" }], unknownColumns: unknown };

  const rows: ImportRow[] = [];
  const errors: CsvImportResult["errors"] = [];
  for (let r = 1; r < table.length; r++) {
    const raw: Record<string, string> = {};
    table[r].forEach((cell, idx) => {
      const key = colFor[idx];
      if (key && cell.trim() !== "") raw[key] = cell;
    });
    const parsed = ImportRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
    else errors.push({ line: r + 1, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  return { rows, errors, unknownColumns: unknown };
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : Array.isArray(v) ? v.join("|") : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}
