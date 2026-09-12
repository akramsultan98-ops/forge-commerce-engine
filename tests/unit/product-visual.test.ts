import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductVisual, productIconName } from "@/components/ProductVisual";
import { SEED_PRODUCTS } from "@/server/seed/demo";
import { DEMO_DISCOVERY_POOL } from "@/server/discovery/demo-pool";

const CATEGORY_ICON: Record<string, string> = { "Home & Kitchen": "CookingPot", "Desk & Tech": "Laptop", "Car & Travel": "Car", Pets: "PawPrint", "Outdoor & Fitness": "Tent" };

describe("product illustrations", () => {
  const titles = [...SEED_PRODUCTS.map((p) => p.title), ...DEMO_DISCOVERY_POOL.map((p) => p.title)];

  it("gives every demo product a drawing chosen from its own name", () => {
    for (const title of titles) expect(productIconName(title), title).not.toBe("Box");
  });

  it("varies the drawing across the demo catalogue instead of one icon per category", () => {
    const seeded = SEED_PRODUCTS.map((p) => productIconName(p.title, CATEGORY_ICON[p.category]));
    expect(new Set(seeded).size).toBeGreaterThanOrEqual(18);
  });

  it("matches the product, not just its category", () => {
    expect(productIconName("Magnetic Cable Organizer (6 Clips)", "Laptop")).toBe("Cable");
    expect(productIconName("Reusable Pet Hair Remover Roller", "PawPrint")).toBe("Brush");
    expect(productIconName("Cordless Handheld Car Vacuum", "Car")).toBe("Wind");
  });

  it("falls back to the category icon, then a neutral box", () => {
    expect(productIconName("Something new", "Laptop")).toBe("Laptop");
    expect(productIconName("Something new", "NotAnIcon")).toBe("Box");
    expect(productIconName("Something new", null)).toBe("Box");
  });
});

describe("ProductVisual markup", () => {
  const render = (imageUrl: string | null) => renderToStaticMarkup(createElement(ProductVisual, { title: "Mini Thermal Label Printer", slug: "mini-thermal-label-printer", imageUrl, categoryName: "Desk & Tech" }));

  it("renders the illustration when there is no image", () => {
    const html = render(null);
    expect(html).toContain('aria-label="Mini Thermal Label Printer — illustration"');
    expect(html).toContain("lucide-printer");
    expect(html).not.toContain("<img");
  });

  it("layers a real image over the illustration so a failed load never leaves a blank tile", () => {
    const html = render("https://cdn.shopify.com/s/files/demo.jpg");
    expect(html).toContain('aria-label="Mini Thermal Label Printer"');
    expect(html).toContain('src="https://cdn.shopify.com/s/files/demo.jpg"');
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("<img")); // plate underneath, photo on top
  });
});
