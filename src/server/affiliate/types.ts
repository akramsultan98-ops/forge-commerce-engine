// The network-agnostic contract between affiliate providers (Amazon today, other networks later),
// n8n, and the rest of FORGE. Nothing outside src/server/affiliate/<provider> knows network details.

import type { AffiliateAvailability, AffiliateNetworkType, Provenance } from "@/lib/constants";

/** A product listing as every provider — and n8n — hands it to FORGE. */
export interface AffiliateProductInput {
  network: AffiliateNetworkType;
  /** Marketplace host, e.g. www.amazon.eg. */
  marketplace: string;
  /** ISO 3166-1 alpha-2, e.g. EG. */
  country: string;
  /** ASIN, or the network's own product id. */
  externalId: string;
  externalIdType?: string;
  parentExternalId?: string | null;
  merchant?: string | null;
  title: string;
  description?: string | null;
  features?: string[];
  category?: string | null;
  categoryPath?: string[];
  brand?: string | null;
  productUrl?: string | null;
  affiliateUrl?: string | null;
  imageUrls?: string[];
  price?: number | null;
  currency?: string | null;
  priceDisplay?: string | null;
  availability?: AffiliateAvailability;
  availabilityMessage?: string | null;
  /** Only when the network legitimately supplies review data (then reviewSource names it). */
  rating?: number | null;
  reviewCount?: number | null;
  reviewSource?: string | null;
  commissionRate?: number | null;
  networkMeta?: Record<string, unknown>;
  /** When the data was fetched from the network. */
  fetchedAt?: Date;
  provenance?: Provenance;
}

export interface AffiliateMarketplace {
  id: string;
  country: string;
  name: string;
  currency: string;
  languages: string[];
  defaultLanguage: string;
  categories: string[];
}

export interface ProviderStatus {
  configured: boolean;
  marketplace: string | null;
  /** Environment variable NAMES that are missing — never values. */
  missing: string[];
  problems: string[];
  warnings: string[];
}

export interface ProviderSearch {
  marketplace?: string;
  keywords: string;
  category?: string;
  limit?: number;
  page?: number;
}

export interface ProviderError {
  id?: string;
  code: string;
  message: string;
}

export interface ProviderResult {
  items: AffiliateProductInput[];
  errors: ProviderError[];
}

/** How the storefront must present this network's data — the network's display rules, resolved for one marketplace. */
export interface ProviderStorefrontPolicy {
  /** Call-to-action on product pages, e.g. "View on Amazon.eg" (tells shoppers where the link goes). */
  ctaLabel: string;
  /** When set, prices are shown only with the time they were observed, followed by this statement. */
  priceDisclaimer: string | null;
  /** Disclosure the network requires next to its links (null = the site-wide affiliate disclosure is enough). */
  disclosure: string | null;
  /** May prices appear in structured data (JSON-LD)? False when displayed data must stay fresh — crawlers keep copies. */
  structuredDataPrice: boolean;
  /** May prices be converted into the visitor's display currency? False = show the network's price as supplied. */
  convertPrices: boolean;
}

export interface AffiliateProvider {
  network: AffiliateNetworkType;
  label: string;
  docsUrl: string;
  /** The kind of id `externalId` holds for this network (ASIN, PRODUCT_ID…). */
  externalIdType: string;
  /** Hours fetched data may be shown before it must be refreshed from the network (null = no rule). */
  maxDataAgeHours: number | null;
  marketplaces(): AffiliateMarketplace[];
  status(): ProviderStatus;
  storefrontPolicy(marketplace: string): ProviderStorefrontPolicy;
  search(query: ProviderSearch): Promise<ProviderResult>;
  getItems(marketplace: string, externalIds: string[]): Promise<ProviderResult>;
}
