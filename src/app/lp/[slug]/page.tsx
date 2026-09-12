import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { faqJsonLd, jsonLd } from "@/domain/seo";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { products } from "@/server/db/schema";
import { getPublishedLandingPage } from "@/server/services/landing-pages";
import { publicProductBySlug, storefront } from "@/server/services/storefront";
import { productPageModel } from "@/server/services/product-page";
import { LandingRenderer } from "@/components/store/LandingRenderer";
import { observedPriceLabel, priceLabel } from "@/components/store/ProductCard";
import { Tracker } from "@/components/store/client";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(slug: string) {
  const { db, org } = await storefront();
  const landing = await getPublishedLandingPage(db, org.id, slug);
  if (!landing) return null;
  const [prod] = await db.select({ slug: products.slug }).from(products).where(eq(products.id, landing.page.productId)).limit(1);
  const data = prod ? await publicProductBySlug(prod.slug) : null;
  return data ? { landing, data } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const r = await load(slug);
  if (!r) return { title: "Page not found", robots: { index: false } };
  const { page } = r.landing;
  const image = page.ogImage ?? r.data.product.imageUrl ?? undefined;
  return {
    title: { absolute: page.seoTitle },
    description: page.metaDescription,
    alternates: { canonical: page.canonicalPath ?? `/products/${r.data.product.slug}` },
    openGraph: { title: page.seoTitle, description: page.metaDescription, images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title: page.seoTitle, description: page.metaDescription },
    robots: r.data.product.isDemo ? { index: false, follow: true } : undefined,
  };
}

export default async function LandingPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await load(slug);
  if (!r) notFound();
  const { product: p, score, link, reviews, network } = r.data;
  const { t, locale } = await getI18n();
  const { org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const visitorId = (await cookies()).get("forge_vid")?.value ?? null;
  const model = await productPageModel(p, { landing: r.landing, score, link, searchParams: sp, visitorId });
  // Products published from a network listing follow the network's display rules.
  const policy = network?.policy ?? null;
  const observedPrice = observedPriceLabel(p, locale);
  const sections = policy ? model.sections.map((s) => (s.type === "HERO" || s.type === "CTA" ? { ...s, content: { ...s.content, ctaLabel: "" } } : s)) : model.sections;
  return (
    <>
      {model.faqs.length > 0 && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqJsonLd(model.faqs)) }} />}
      <Suspense>
        <Tracker productId={p.id} landingPageId={r.landing.page.id} experimentId={model.experiment?.id} variant={model.experiment?.variant} />
      </Suspense>
      {p.isDemo && (
        <p className="mx-auto max-w-[1200px] px-5 text-xs text-ember-ink md:px-10">
          <span className="eyebrow me-2">{t("product.demoBadge")}</span>
          {t("product.demoNote")}
        </p>
      )}
      {policy?.disclosure && <p className="mx-auto max-w-[1200px] px-5 pt-4 text-xs text-muted md:px-10">{policy.disclosure}</p>}
      <LandingRenderer
        sections={sections}
        ctx={{
          title: p.title,
          slug: p.slug,
          imageUrl: p.imageUrl,
          categoryName: p.categoryName,
          categoryIcon: p.categoryIcon,
          ctaHref: model.ctaHref,
          ctaLabel: policy?.ctaLabel ?? model.ctaLabel,
          unavailableLabel: "Not available yet",
          priceText: observedPrice ?? priceLabel(p, display, rates, locale),
          merchantNote: observedPrice && policy?.priceDisclaimer ? policy.priceDisclaimer : p.businessModel === "AFFILIATE" ? t("product.merchantNote") : t("product.priceNote"),
          sponsored: p.businessModel === "AFFILIATE",
          reviews,
          labels: { problem: t("home.problemLabel"), howItWorks: t("product.howItWorks"), faq: t("product.faq"), shipping: t("product.shipping"), returns: t("product.returns"), disclosure: t("product.disclosure"), whyInterested: t("product.whyInterested") },
        }}
      />
    </>
  );
}
