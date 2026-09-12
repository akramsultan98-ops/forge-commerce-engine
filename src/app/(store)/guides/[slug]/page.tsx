import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { formatDate } from "@/lib/utils";
import { jsonLd } from "@/domain/seo";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { env } from "@/server/env";
import { getPublishedArticle } from "@/server/services/articles";
import { productsByIds, storefront } from "@/server/services/storefront";
import { ProductCard } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

type Params = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  const { db, org } = await storefront();
  return getPublishedArticle(db, org.id, slug);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const a = await load(slug);
  if (!a) return { title: "Guide not found", robots: { index: false } };
  return { title: { absolute: a.seoTitle ?? a.title }, description: a.metaDescription ?? a.excerpt ?? undefined, alternates: { canonical: `/guides/${slug}` }, openGraph: { type: "article", title: a.title, description: a.excerpt ?? undefined } };
}

export default async function GuidePage({ params }: Params) {
  const { slug } = await params;
  const a = await load(slug);
  if (!a) notFound();
  const { t, locale } = await getI18n();
  const { org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const items = await productsByIds(a.productIds);
  const byId = new Map(items.map((p) => [p.id, p]));
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: a.title, description: a.excerpt, datePublished: a.publishedAt?.toISOString(), dateModified: a.updatedAt.toISOString(), mainEntityOfPage: new URL(`/guides/${a.slug}`, env().APP_URL).toString(), publisher: { "@type": "Organization", name: "FORGE" } };

  return (
    <article className="mx-auto max-w-[760px] px-5 pt-14 md:pt-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <Suspense>
        <Tracker />
      </Suspense>
      <p className="eyebrow text-muted">
        {t("nav.guides")} · {a.publishedAt ? formatDate(a.publishedAt, locale) : ""}
      </p>
      <h1 className="mt-4 text-balance font-display text-5xl leading-[1.0] text-ink md:text-6xl">{a.title}</h1>
      {a.excerpt && <p className="mt-6 text-lg leading-relaxed text-ink-2">{a.excerpt}</p>}
      {a.isDemo && <p className="mt-6 rounded-[2px] border border-ember/40 bg-ember/5 px-4 py-3 text-sm text-ink-2">{t("product.demoNote")}</p>}
      <div className="mt-12 space-y-6 border-t border-ink pt-10">
        {a.body.blocks.map((b, i) => {
          if (b.kind === "h2") return <h2 key={i} className="pt-6 font-display text-3xl text-ink">{b.text}</h2>;
          if (b.kind === "list")
            return (
              <ul key={i} className="space-y-1.5 text-[15px] text-ink-2">
                {(b.items ?? []).map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            );
          if (b.kind === "product") {
            const p = b.productId ? byId.get(b.productId) : undefined;
            return p ? (
              <div key={i} className="max-w-xs py-2">
                <ProductCard p={p} display={display} rates={rates} locale={locale} scoreLabel={t("product.score")} />
              </div>
            ) : null;
          }
          return (
            <p key={i} className="text-[17px] leading-[1.75] text-ink-2">
              {b.text}
            </p>
          );
        })}
      </div>
    </article>
  );
}
