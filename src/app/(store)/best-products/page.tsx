import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { publicProducts, storefront } from "@/server/services/storefront";
import { latestScores } from "@/server/services/scoring";
import { ProductVisual } from "@/components/ProductVisual";
import { priceLabel } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

export const metadata: Metadata = { title: "The best products on FORGE", description: "Our highest-scoring products, with the reasons behind each score.", alternates: { canonical: "/best-products" } };

export default async function BestProductsPage() {
  const { t, locale } = await getI18n();
  const { db, org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const items = await publicProducts({ sort: "score", limit: 12 });
  const scores = await latestScores({ db }, items.map((p) => p.id));
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-10 md:pt-20">
      <Suspense>
        <Tracker />
      </Suspense>
      <header className="max-w-3xl border-b border-ink pb-10">
        <p className="eyebrow text-muted">{t("nav.best")}</p>
        <h1 className="mt-4 font-display text-6xl leading-[0.95] text-ink md:text-7xl">{t("listing.bestTitle")}</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{t("listing.bestSub")}</p>
      </header>
      <ol className="divide-y divide-line">
        {items.map((p, i) => {
          const s = scores.get(p.id);
          return (
            <li key={p.id}>
              <Link href={`/products/${p.slug}`} className="group grid gap-6 py-10 md:grid-cols-12 md:items-center">
                <span className="font-display text-5xl leading-none text-ink/30 md:col-span-1">{i + 1}</span>
                <div className="overflow-hidden md:col-span-3">
                  <ProductVisual title={p.title} slug={p.slug} imageUrl={p.imageUrl} categoryName={p.categoryName} categoryIcon={p.categoryIcon} index={i + 1} className="aspect-[4/3] w-full transition-transform duration-700 group-hover:scale-[1.02]" />
                </div>
                <div className="md:col-span-6">
                  <p className="eyebrow text-muted">{p.categoryName}</p>
                  <h2 className="mt-2 font-display text-3xl leading-tight text-ink md:text-4xl">{p.title}</h2>
                  <ul className="mt-4 space-y-1.5 text-sm text-ink-2">
                    {(s?.reasons ?? []).slice(0, 3).map((r) => (
                      <li key={r} className="flex gap-2">
                        <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex items-baseline justify-between gap-4 md:col-span-2 md:flex-col md:items-end">
                  <span className="font-display text-5xl leading-none text-ink">{p.overallScore !== null ? Math.round(p.overallScore) : "—"}</span>
                  <span className="tabular text-sm text-muted">{priceLabel(p, display, rates, locale)}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
      {!items.length && <p className="mt-16 text-muted">{t("listing.empty")}</p>}
    </div>
  );
}
