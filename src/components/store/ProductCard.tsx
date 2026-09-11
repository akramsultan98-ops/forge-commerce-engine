import Link from "next/link";
import { convert, formatMoney } from "@/domain/money";
import { cn } from "@/lib/utils";
import type { PublicProduct } from "@/server/services/storefront";
import { ProductVisual } from "../ProductVisual";

export function priceLabel(p: Pick<PublicProduct, "sellingPrice" | "currency">, display: string, rates: Record<string, number>, locale: string) {
  if (p.sellingPrice === null) return null;
  if (p.currency === display) return formatMoney(p.sellingPrice, display, locale);
  return `≈ ${formatMoney(convert(p.sellingPrice, p.currency, display, rates), display, locale)}`;
}

export function ProductCard({
  p,
  index,
  display,
  rates,
  locale,
  scoreLabel,
  note,
  size = "md",
}: {
  p: PublicProduct;
  index?: number;
  display: string;
  rates: Record<string, number>;
  locale: string;
  scoreLabel: string;
  note?: string;
  size?: "md" | "lg";
}) {
  const price = priceLabel(p, display, rates, locale);
  return (
    <Link href={`/products/${p.slug}`} className="group block focus-visible:outline-offset-4">
      <div className="overflow-hidden">
        <ProductVisual title={p.title} slug={p.slug} imageUrl={p.imageUrl} categoryName={p.categoryName} categoryIcon={p.categoryIcon} index={index} className={cn("w-full transition-transform duration-700 ease-out group-hover:scale-[1.025]", size === "lg" ? "aspect-[4/5]" : "aspect-[4/5]")} />
      </div>
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className={cn("text-balance font-medium leading-snug text-ink", size === "lg" ? "text-lg" : "text-[15px]")}>{p.title}</h3>
          {(note || p.problemSolved) && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">{note ?? `Fixes ${p.problemSolved}.`}</p>}
        </div>
        <div className="shrink-0 text-end">
          {price && <p className="tabular text-[15px] text-ink">{price}</p>}
          {p.overallScore !== null && (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
              {scoreLabel} {Math.round(p.overallScore)}
            </p>
          )}
        </div>
      </div>
      {p.isDemo && <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ember-ink">Demo listing</p>}
    </Link>
  );
}

export function SectionHead({ eyebrow, title, sub, href, viewAll }: { eyebrow?: string; title: string; sub?: string; href?: string; viewAll?: string }) {
  return (
    <div className="mb-10 flex flex-col gap-4 border-t border-ink pt-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="eyebrow mb-3 text-muted">{eyebrow}</p>}
        <h2 className="font-display text-4xl leading-[1.02] tracking-[-0.01em] text-ink md:text-5xl">{title}</h2>
        {sub && <p className="mt-3 text-[15px] leading-relaxed text-muted">{sub}</p>}
      </div>
      {href && viewAll && (
        <Link href={href} className="group inline-flex items-center gap-2 text-sm text-ink">
          <span className="underline decoration-line underline-offset-[6px] transition-colors group-hover:decoration-ink">{viewAll}</span>
          <span aria-hidden className="transition-transform group-hover:translate-x-0.5 rtl:rotate-180">→</span>
        </Link>
      )}
    </div>
  );
}
