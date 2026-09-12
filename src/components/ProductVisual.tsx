// Product imagery. Real supplier/merchant images when available; otherwise — and whenever a real
// image fails to load — an editorial "catalogue plate" drawn from the product's own name (never a
// stock photo that misrepresents the product). The plate is always rendered underneath the photo.

import type { LucideIcon } from "lucide-react";
import { Archive, Bone, Box, Brush, Cable, Car, Cat, CookingPot, Dog, Dumbbell, Fan, Flashlight, GlassWater, Laptop, Lightbulb, Luggage, Magnet, Monitor, PawPrint, Printer, Refrigerator, Shirt, Smartphone, Soup, Tent, UtensilsCrossed, Wind } from "lucide-react";
import { cn, hashString } from "@/lib/utils";
import { ProductPhoto } from "./ProductPhoto";

const ICONS = { Archive, Bone, Box, Brush, Cable, Car, Cat, CookingPot, Dog, Dumbbell, Fan, Flashlight, GlassWater, Laptop, Lightbulb, Luggage, Magnet, Monitor, PawPrint, Printer, Refrigerator, Shirt, Smartphone, Soup, Tent, UtensilsCrossed, Wind } satisfies Record<string, LucideIcon>;
export type ProductIconName = keyof typeof ICONS;

/** Icons stored on categories (see the demo seed) — the fallback when the product name gives no hint. */
const CATEGORY_ICONS: ReadonlySet<string> = new Set<ProductIconName>(["CookingPot", "Laptop", "Car", "PawPrint", "Tent"]);

/** Most specific first: the product's name picks the drawing. */
const TITLE_ICONS: Array<[RegExp, ProductIconName]> = [
  [/lantern|flashlight|torch/, "Flashlight"],
  [/\blight\b|lamp/, "Lightbulb"],
  [/fabric shaver|lint|sweater/, "Shirt"],
  [/pet hair|groom/, "Brush"],
  [/dish rack/, "UtensilsCrossed"],
  [/cable|charger/, "Cable"],
  [/spice/, "Magnet"],
  [/printer/, "Printer"],
  [/privacy screen|monitor/, "Monitor"],
  [/laptop/, "Laptop"],
  [/phone/, "Smartphone"],
  [/vacuum/, "Wind"],
  [/trunk/, "Archive"],
  [/packing cube|suitcase|luggage/, "Luggage"],
  [/bowl/, "Bone"],
  [/\bdogs?\b/, "Dog"],
  [/\bcats?\b/, "Cat"],
  [/\bfan\b/, "Fan"],
  [/resistance band|dumbbell|workout/, "Dumbbell"],
  [/bottle/, "GlassWater"],
  [/\blids?\b/, "Soup"],
  [/food storage/, "Refrigerator"],
  [/\bcar\b|car seat/, "Car"],
];
const TONES = ["#e8e4da", "#dedad0", "#e5ded3", "#d9ddd5", "#e2e0da", "#dde0e2", "#e9e1d6"];

/** The drawing for a product: from its name, else its category's icon, else a neutral box. */
export function productIconName(title: string, categoryIcon?: string | null): ProductIconName {
  const t = title.toLowerCase();
  const fromTitle = TITLE_ICONS.find(([re]) => re.test(t))?.[1];
  if (fromTitle) return fromTitle;
  return categoryIcon && CATEGORY_ICONS.has(categoryIcon) ? (categoryIcon as ProductIconName) : "Box";
}

export function ProductVisual({
  title,
  slug,
  imageUrl,
  categoryName,
  categoryIcon,
  index,
  className,
  size = "lg",
  eager,
}: {
  title: string;
  slug: string;
  imageUrl?: string | null;
  categoryName?: string | null;
  categoryIcon?: string | null;
  index?: number;
  className?: string;
  size?: "sm" | "md" | "lg";
  eager?: boolean;
}) {
  const h = hashString(slug);
  const tone = TONES[h % TONES.length];
  const Icon = ICONS[productIconName(title, categoryIcon)];
  const n = String(index ?? (h % 97) + 1).padStart(3, "0");
  return (
    <div
      role="img"
      aria-label={imageUrl ? title : `${title} — illustration`}
      className={cn("relative overflow-hidden text-ink", className)}
      style={{ background: `radial-gradient(120% 90% at 28% 18%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 58%), ${tone}` }}
    >
      <div aria-hidden className="absolute inset-0 grid place-items-center">
        <Icon strokeWidth={size === "sm" ? 1.25 : 0.6} className={cn("text-ink/75", size === "sm" ? "h-1/2 w-1/2" : "h-[46%] w-[46%]")} />
      </div>
      {size !== "sm" && (
        <div aria-hidden>
          <span className="absolute start-4 top-4 font-mono text-[10px] tracking-[0.2em] text-ink/55">N° {n}</span>
          <span className="absolute inset-x-4 bottom-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-ink/55">
            <span className="truncate">{categoryName ?? "FORGE"}</span>
            <span>FORGE</span>
          </span>
        </div>
      )}
      {imageUrl && <ProductPhoto src={imageUrl} eager={eager} />}
    </div>
  );
}
