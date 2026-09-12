import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { cn } from "@/lib/utils";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { publicCategories, publicCategoryBySlug, publicProducts, storefront } from "@/server/services/storefront";
import { ProductCard } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

export const metadata: Metadata = { title: "All products", alternates: { canonical: "/products" } };

export default async function ProductsIndex({ searchParams }: { searchParams: Promise<{ category?: string; link?: string }> }) {
  const { t, locale } = await getI18n();
  const sp = await searchParams;
  const { org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const [cats, active] = await Promise.all([publicCategories(), sp.category ? publicCategoryBySlug(sp.category) : Promise.resolve(null)]);
  const items = await publicProducts({ sort: "score", categoryId: active?.id, limit: 60 });
  return (
    <div className="mx-auto max-w-[1400px] px-5 pt-14 md:px-10 md:pt-20">
      <Suspense>
        <Tracker />
      </Suspense>
      <header className="max-w-3xl">
        <p className="eyebrow text-muted">{t("nav.products")}</p>
        <h1 className="mt-4 font-display text-6xl leading-[0.95] tracking-[-0.02em] text-ink md:text-7xl">{active?.name ?? t("listing.allProducts")}</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{active?.description ?? t("listing.allProductsSub")}</p>
      </header>
      {sp.link === "unknown" && <p className="mt-6 rounded-[2px] border border-line p-4 text-sm text-ink-2">{t("product.unavailable")}</p>}
      <nav aria-label="Categories" className="mt-10 flex flex-wrap gap-2 border-y border-line py-4">
        <Link href="/products" className={cn("rounded-full border px-4 py-1.5 text-sm transition-colors", !active ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink")}>
          {t("listing.filterAll")}
        </Link>
        {cats.map((c) => (
          <Link key={c.id} href={`/products?category=${c.slug}`} className={cn("rounded-full border px-4 py-1.5 text-sm transition-colors", active?.id === c.id ? "border-ink bg-ink text-paper" : "border-line text-ink-2 hover:border-ink")}>
            {c.name} <span className="tabular opacity-60">{c.n}</span>
          </Link>
        ))}
      </nav>
      {items.length ? (
        <div className="mt-12 grid grid-cols-2 gap-x-5 gap-y-14 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <ProductCard key={p.id} p={p} index={i + 1} display={display} rates={rates} locale={locale} scoreLabel={t("product.score")} />
          ))}
        </div>
      ) : (
        <p className="mt-16 text-muted">{t("listing.empty")}</p>
      )}
    </div>
  );
}
