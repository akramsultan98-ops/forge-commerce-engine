import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { breadcrumbJsonLd, jsonLd, metaDescription } from "@/domain/seo";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { env } from "@/server/env";
import { publicCategoryBySlug, publicProducts, storefront } from "@/server/services/storefront";
import { ProductCard } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const c = await publicCategoryBySlug(slug);
  if (!c) return { title: "Category not found", robots: { index: false } };
  return { title: `${c.name} — products worth discovering`, description: metaDescription(c.description ?? `The best ${c.name.toLowerCase()} products on FORGE, ranked by an explainable score.`), alternates: { canonical: `/category/${slug}` } };
}

export default async function CategoryPage({ params }: Params) {
  const { slug } = await params;
  const c = await publicCategoryBySlug(slug);
  if (!c) notFound();
  const { t, locale } = await getI18n();
  const { org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const items = await publicProducts({ sort: "score", categoryId: c.id, limit: 60 });
  const app = env().APP_URL;
  return (
    <div className="mx-auto max-w-[1400px] px-5 pt-14 md:px-10 md:pt-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbJsonLd([{ name: "FORGE", url: app }, { name: c.name, url: new URL(`/category/${c.slug}`, app).toString() }])) }} />
      <Suspense>
        <Tracker />
      </Suspense>
      <header className="max-w-3xl border-b border-line pb-10">
        <p className="eyebrow text-muted">{t("nav.products")}</p>
        <h1 className="mt-4 font-display text-6xl leading-[0.95] text-ink md:text-7xl">{c.name}</h1>
        {c.description && <p className="mt-5 text-lg leading-relaxed text-muted">{c.description}</p>}
      </header>
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
