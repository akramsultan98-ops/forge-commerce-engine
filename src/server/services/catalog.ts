import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { slugify } from "@/lib/utils";
import { assertCan, type ServiceContext } from "../context";
import { categories, products, suppliers } from "../db/schema";
import { audit } from "../audit";
import { ValidationError } from "../errors";

export async function listCategories(ctx: Pick<ServiceContext, "db" | "orgId">) {
  const rows = await ctx.db
    .select({ category: categories, productCount: count(products.id) })
    .from(categories)
    .leftJoin(products, eq(products.categoryId, categories.id))
    .where(eq(categories.organizationId, ctx.orgId))
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
  return rows.map((r) => ({ ...r.category, productCount: Number(r.productCount) }));
}

export async function getCategoryBySlug(ctx: Pick<ServiceContext, "db" | "orgId">, slug: string) {
  const [row] = await ctx.db.select().from(categories).where(and(eq(categories.organizationId, ctx.orgId), eq(categories.slug, slug))).limit(1);
  return row ?? null;
}

const CategoryInput = z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).optional(), parentId: z.string().uuid().nullable().optional(), icon: z.string().max(40).optional() });

export async function upsertCategory(ctx: ServiceContext, raw: unknown, isDemo = false) {
  assertCan(ctx, "products:write");
  const parsed = CategoryInput.safeParse(raw);
  if (!parsed.success) throw new ValidationError("Invalid category", parsed.error.issues);
  const slug = slugify(parsed.data.name);
  const [row] = await ctx.db
    .insert(categories)
    .values({ organizationId: ctx.orgId, slug, name: parsed.data.name, description: parsed.data.description ?? null, parentId: parsed.data.parentId ?? null, icon: parsed.data.icon ?? null, isDemo })
    .onConflictDoUpdate({ target: [categories.organizationId, categories.slug], set: { name: parsed.data.name, description: parsed.data.description ?? null } })
    .returning();
  await audit(ctx, "category.upsert", { type: "category", id: row.id });
  return row;
}

/** Finds or creates a category by display name (used by importers). */
export async function categoryIdFor(ctx: ServiceContext, name: string | null | undefined): Promise<string | null> {
  if (!name) return null;
  const slug = slugify(name);
  const [existing] = await ctx.db.select({ id: categories.id }).from(categories).where(and(eq(categories.organizationId, ctx.orgId), eq(categories.slug, slug))).limit(1);
  if (existing) return existing.id;
  const [row] = await ctx.db.insert(categories).values({ organizationId: ctx.orgId, slug, name: name.trim().slice(0, 80) }).onConflictDoNothing().returning({ id: categories.id });
  return row?.id ?? null;
}

export async function listSuppliers(ctx: Pick<ServiceContext, "db" | "orgId">) {
  return ctx.db.select().from(suppliers).where(eq(suppliers.organizationId, ctx.orgId)).orderBy(asc(suppliers.name));
}

export async function supplierIdFor(ctx: ServiceContext, name: string | null | undefined, adapter: "MANUAL_IMPORT" | "CJ" | "ALIEXPRESS" | "SHOPIFY_SUPPLIER" | "AFFILIATE_NETWORK" = "MANUAL_IMPORT"): Promise<string | null> {
  if (!name) return null;
  const [existing] = await ctx.db.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.organizationId, ctx.orgId), eq(suppliers.name, name.trim()))).limit(1);
  if (existing) return existing.id;
  const [row] = await ctx.db.insert(suppliers).values({ organizationId: ctx.orgId, name: name.trim().slice(0, 120), adapter }).returning({ id: suppliers.id });
  return row.id;
}
