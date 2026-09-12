import type { Metadata } from "next";
import { Suspense } from "react";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { publicProducts, storefront } from "@/server/services/storefront";
import { ProductCard } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

export const metadata: Metadata = { title: "Trending now", description: "Products with the strongest trend signals this week — every signal labelled with its source.", alternates: { canonical: "/trending" } };

export default async function TrendingPage() {
  const { t, locale } = await getI18n();
  const { org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const items = (await publicProducts({ sort: "trend", limit: 24 })).filter((p) => p.trendScore !== null);
  return (
    <div className="mx-auto max-w-[1400px] px-5 pt-14 md:px-10 md:pt-20">
      <Suspense>
        <Tracker />
      </Suspense>
      <header className="max-w-3xl border-b border-line pb-10">
        <p className="eyebrow text-muted">{t("nav.trending")}</p>
        <h1 className="mt-4 font-display text-6xl leading-[0.95] text-ink md:text-7xl">{t("listing.trendingTitle")}</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{t("listing.trendingSub")}</p>
      </header>
      {items.length ? (
        <div className="mt-12 grid grid-cols-2 gap-x-5 gap-y-14 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p, i) => (
            <ProductCard
              key={p.id}
              p={p}
              index={i + 1}
              display={display}
              rates={rates}
              locale={locale}
              scoreLabel={t("product.score")}
              note={`Trend index ${Math.round(p.trendScore ?? 0)} · ${t(`provenance.${p.fieldProvenance?.trendScore?.p ?? "MISSING"}`)}`}
            />
          ))}
        </div>
      ) : (
        <p className="mt-16 text-muted">{t("listing.empty")}</p>
      )}
    </div>
  );
}
