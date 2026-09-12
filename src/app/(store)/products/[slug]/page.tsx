import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { FACTOR_META, SCORING_FACTORS } from "@/domain/scoring";
import { breadcrumbJsonLd, faqJsonLd, jsonLd, metaDescription, productJsonLd, seoTitle } from "@/domain/seo";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { env } from "@/server/env";
import { buildBrief } from "@/server/ai/brief";
import { getPrimaryPageForProduct } from "@/server/services/landing-pages";
import { publicProductBySlug, publicProducts, storefront } from "@/server/services/storefront";
import { productPageModel } from "@/server/services/product-page";
import { LandingRenderer } from "@/components/store/LandingRenderer";
import { ProductCard, SectionHead, priceLabel } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const data = await publicProductBySlug(slug);
  if (!data) return { title: "Product not found", robots: { index: false } };
  const { db } = await storefront();
  const landing = await getPrimaryPageForProduct(db, data.product.id, { publishedOnly: true });
  const title = landing?.page.seoTitle ?? seoTitle(`${data.product.title}${data.product.problemSolved ? `: the fix for ${data.product.problemSolved}` : ""}`);
  const description = landing?.page.metaDescription ?? metaDescription(data.product.description ?? `${data.product.title} — ${data.product.problemSolved ?? "a practical pick"}.`);
  const image = landing?.page.ogImage ?? data.product.imageUrl ?? undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/products/${slug}` },
    openGraph: { type: "website", title, description, url: `/products/${slug}`, images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title, description, images: image ? [image] : undefined },
    robots: data.product.isDemo ? { index: false, follow: true } : undefined,
  };
}

export default async function ProductPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const data = await publicProductBySlug(slug);
  if (!data) notFound();
  const { product: p, score, link, reviews } = data;
  const { t, locale } = await getI18n();
  const { db, org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const visitorId = (await cookies()).get("forge_vid")?.value ?? null;
  const landing = await getPrimaryPageForProduct(db, p.id, { publishedOnly: true });
  const model = await productPageModel(p, { landing, score, link, searchParams: sp, visitorId });
  const related = await publicProducts({ sort: "score", categoryId: p.categoryId ?? undefined, excludeIds: [p.id], limit: 4 });
  const brief = buildBrief(p);
  const appUrl = env().APP_URL;
  const url = new URL(`/products/${p.slug}`, appUrl).toString();
  const ld = [
    productJsonLd({ name: p.title, description: p.description ?? p.title, url, image: p.imageUrl, brand: p.brand, sku: p.sourceProductId, price: p.sellingPrice, currency: p.currency, available: p.available, rating: brief.rating ? { value: brief.rating.value, count: brief.rating.count } : null, offerUrl: url }),
    breadcrumbJsonLd([
      { name: "FORGE", url: appUrl },
      ...(p.categorySlug ? [{ name: p.categoryName ?? "", url: new URL(`/category/${p.categorySlug}`, appUrl).toString() }] : []),
      { name: p.title, url },
    ]),
    ...(model.faqs.length ? [faqJsonLd(model.faqs)] : []),
  ];

  return (
    <>
      {ld.map((obj, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(obj) }} />
      ))}
      <Suspense>
        <Tracker productId={p.id} landingPageId={model.page?.id} experimentId={model.experiment?.id} variant={model.experiment?.variant} />
      </Suspense>
      <nav aria-label="Breadcrumb" className="mx-auto max-w-[1200px] px-5 pt-8 text-xs text-muted md:px-10">
        <Link href="/" className="hover:text-ink">
          FORGE
        </Link>
        {p.categorySlug && (
          <>
            {" / "}
            <Link href={`/category/${p.categorySlug}`} className="hover:text-ink">
              {p.categoryName}
            </Link>
          </>
        )}
        {" / "}
        <span className="text-ink-2">{p.title}</span>
      </nav>
      {(p.isDemo || sp.unavailable) && (
        <div className="mx-auto mt-4 max-w-[1200px] px-5 md:px-10">
          <p className="rounded-[2px] border border-ember/40 bg-ember/5 px-4 py-3 text-sm text-ink-2">
            {sp.unavailable ? t("product.unavailable") : <><span className="eyebrow me-2 text-ember-ink">{t("product.demoBadge")}</span>{t("product.demoNote")}</>}
          </p>
        </div>
      )}

      <LandingRenderer
        sections={model.sections}
        ctx={{
          title: p.title,
          slug: p.slug,
          imageUrl: p.imageUrl,
          categoryName: p.categoryName,
          categoryIcon: p.categoryIcon,
          ctaHref: model.ctaHref,
          ctaLabel: model.ctaLabel,
          unavailableLabel: "Not available yet",
          priceText: priceLabel(p, display, rates, locale),
          merchantNote: p.businessModel === "AFFILIATE" ? t("product.merchantNote") : t("product.priceNote"),
          sponsored: p.businessModel === "AFFILIATE",
          reviews,
          labels: { problem: t("home.problemLabel"), howItWorks: t("product.howItWorks"), faq: t("product.faq"), shipping: t("product.shipping"), returns: t("product.returns"), disclosure: t("product.disclosure"), whyInterested: t("product.whyInterested") },
        }}
      />

      {score && (
        <section className="mx-auto mt-10 max-w-[1200px] px-5 md:px-10">
          <div className="grid gap-10 border-t border-ink pt-10 md:grid-cols-12">
            <div className="md:col-span-4">
              <p className="eyebrow text-muted">{t("product.scoreBreakdown")}</p>
              <p className="mt-4 font-display text-8xl leading-none text-ink">{Math.round(score.overall)}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{t("home.intelSub")}</p>
              {score.reasons.length > 0 && (
                <ul className="mt-6 space-y-2 text-sm text-ink-2">
                  {score.reasons.slice(0, 4).map((r) => (
                    <li key={r} className="flex gap-2">
                      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
                      {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <ul className="space-y-3.5 md:col-span-8">
              {SCORING_FACTORS.map((f) => {
                const fr = score.factors[f];
                if (!fr) return null;
                return (
                  <li key={f} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-4 text-sm">
                    <span className="truncate text-ink-2" title={fr.note}>
                      {FACTOR_META[f].label}
                    </span>
                    <span className="flex h-3 items-center">
                      <span className="block h-1.5 rounded-e-[4px] bg-ink" style={{ width: `${Math.max(2, fr.score)}%` }} />
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tabular w-7 text-end text-ink">{Math.round(fr.score)}</span>
                      <span className="w-28 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{t(`provenance.${fr.provenance}`)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mx-auto mt-24 max-w-[1400px] px-5 md:px-10">
          <SectionHead title={t("product.related")} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-4">
            {related.map((r, i) => (
              <ProductCard key={r.id} p={r} index={i + 1} display={display} rates={rates} locale={locale} scoreLabel={t("product.score")} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
