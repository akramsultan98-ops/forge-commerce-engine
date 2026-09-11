// SEO engine — titles, descriptions and schema.org JSON-LD for products, FAQs and breadcrumbs.

import { truncate } from "@/lib/utils";

export function seoTitle(title: string, brand = "FORGE"): string {
  const suffix = ` — ${brand}`;
  return truncate(title, 60 - suffix.length) + suffix;
}

export function metaDescription(text: string): string {
  return truncate(text.replace(/\s+/g, " ").trim(), 155);
}

/** Serialises JSON-LD safely for inline <script> (prevents </script> breakout). */
export function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export interface ProductLdInput {
  name: string;
  description: string;
  url: string;
  image?: string | null;
  brand?: string | null;
  sku?: string | null;
  price?: number | null;
  currency: string;
  available: boolean;
  /** Only pass REAL, attributable ratings — never fabricated. */
  rating?: { value: number; count: number } | null;
  offerUrl?: string | null;
}

export function productJsonLd(p: ProductLdInput) {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description,
    url: p.url,
  };
  if (p.image) ld.image = [p.image];
  if (p.brand) ld.brand = { "@type": "Brand", name: p.brand };
  if (p.sku) ld.sku = p.sku;
  if (typeof p.price === "number") {
    ld.offers = {
      "@type": "Offer",
      price: p.price.toFixed(2),
      priceCurrency: p.currency,
      availability: p.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: p.offerUrl ?? p.url,
    };
  }
  if (p.rating && p.rating.count > 0) {
    ld.aggregateRating = { "@type": "AggregateRating", ratingValue: p.rating.value, reviewCount: p.rating.count };
  }
  return ld;
}

export function faqJsonLd(faqs: Array<{ q: string; a: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

export function absoluteUrl(appUrl: string, path: string): string {
  return new URL(path, appUrl.endsWith("/") ? appUrl : `${appUrl}/`).toString();
}
