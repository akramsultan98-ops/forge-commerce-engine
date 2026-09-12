import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { productScores, products } from "@/server/db/schema";
import { createProduct, listProducts, setProductStatus, updateProduct } from "@/server/services/products";
import { scoreProductById } from "@/server/services/scoring";
import { importCsv } from "@/server/discovery/service";
import { getSetting, setSetting } from "@/server/settings";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { asRole, freshDb, sampleProduct } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => t.close());

describe("product database", () => {
  it("creates products with provenance and a unique slug", async () => {
    const a = await createProduct(t.ctx, sampleProduct());
    const b = await createProduct(t.ctx, sampleProduct());
    expect(a.slug).toBe("magnetic-cable-organizer-6-clips");
    expect(b.slug).toBe("magnetic-cable-organizer-6-clips-2");
    expect(a.fieldProvenance.cost.p).toBe("MANUAL");
    expect(a.status).toBe("DISCOVERED");
    expect(Math.round(a.estimatedMargin!)). toBe(70);
  });

  it("validates input", async () => {
    await expect(createProduct(t.ctx, { title: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createProduct(t.ctx, sampleProduct({ affiliateUrl: "javascript:alert(1)" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("enforces RBAC on writes", async () => {
    await expect(createProduct(asRole(t.ctx, "viewer"), sampleProduct())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProduct(asRole(t.ctx, "operator"), sampleProduct({ title: "Operator product" }))).resolves.toBeTruthy();
  });

  it("only relabels provenance of fields that actually changed", async () => {
    const p = await createProduct(t.ctx, sampleProduct({ title: "Provenance probe" }), { provenance: "REAL", sourceLabel: "cj" });
    const updated = await updateProduct(t.ctx, p.id, { ...sampleProduct({ title: "Provenance probe" }), cost: 3.3 }, "MANUAL", "operator");
    expect(updated.fieldProvenance.cost.p).toBe("MANUAL");
    expect(updated.fieldProvenance.sellingPrice.p).toBe("REAL");
  });

  it("scores products, stores history and denormalises the latest score", async () => {
    const p = await createProduct(t.ctx, sampleProduct({ title: "Score probe" }));
    const s = await scoreProductById(t.ctx, p.id);
    expect(s.overall).toBeGreaterThan(50);
    const [row] = await t.db.select().from(products).where(eq(products.id, p.id));
    expect(row.overallScore).toBe(s.overall);
    expect((await t.db.select().from(productScores).where(eq(productScores.productId, p.id))).length).toBe(1);
  });

  it("uses configurable weights from settings", async () => {
    await setSetting(t.ctx, "scoring.weights", { trend: 100, velocity: 0, margin: 0, content: 0, problem: 0, impulse: 0, competition: 0, novelty: 0, shipping: 0 });
    const p = await createProduct(t.ctx, sampleProduct({ title: "Weight probe", trendScore: 33 }));
    expect((await scoreProductById(t.ctx, p.id)).overall).toBe(33);
    await setSetting(t.ctx, "scoring.weights", { trend: 15, velocity: 15, margin: 15, content: 15, problem: 10, impulse: 10, competition: 10, novelty: 5, shipping: 5 });
    expect((await getSetting(t.ctx, "scoring.weights")).trend).toBe(15);
    await expect(setSetting(t.ctx, "testing.thresholds", { minDays: 20, maxDays: 10 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("imports CSV feeds and scores every new product", async () => {
    const r = await importCsv(t.ctx, "title,price,commission,url,category\nMini Label Printer,39.99,10,https://m.example/p,Desk & Tech\nX,,,,\n");
    expect(r.created).toBe(1);
    expect(r.errors).toHaveLength(1);
    const { items } = await listProducts(t.ctx, { q: "Label Printer" });
    expect(items[0].overallScore).not.toBeNull();
    expect(items[0].categoryName).toBe("Desk & Tech");
  });

  it("creates a test when a product moves to TESTING and filters lists", async () => {
    const p = await createProduct(t.ctx, sampleProduct({ title: "Test probe" }));
    await setProductStatus(t.ctx, p.id, "TESTING");
    const { items } = await listProducts(t.ctx, { status: "TESTING" });
    expect(items.map((i) => i.id)).toContain(p.id);
  });
});
