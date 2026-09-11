import type { BusinessModel, Provenance, SourceAdapterKey } from "@/lib/constants";

export interface DiscoveredProduct {
  sourceProductId: string;
  title: string;
  description?: string;
  category?: string;
  brand?: string;
  supplierName?: string;
  supplierUrl?: string;
  productUrl?: string;
  affiliateUrl?: string;
  imageUrl?: string;
  currency: string;
  cost?: number;
  sellingPrice?: number;
  shippingCost?: number;
  commissionPercentage?: number;
  affiliateCommission?: number;
  shippingDaysMin?: number;
  shippingDaysMax?: number;
  countriesAvailable?: string[];
  rating?: number;
  reviewCount?: number;
  reviewGrowth?: number;
  estimatedSales?: number;
  sellerCount?: number;
  trendKeyword?: string;
  highlights?: string[];
  tags?: string[];
  problemSolved?: string;
  targetAudience?: string;
  businessModel?: BusinessModel;
  // Optional qualitative factor inputs (must carry provenance, e.g. DEMO or MANUAL)
  trendScore?: number;
  competitionScore?: number;
  contentScore?: number;
  impulseScore?: number;
  problemScore?: number;
  noveltyScore?: number;
  saturationScore?: number;
  /** Provenance applied to every numeric field this adapter returns. */
  provenance: Provenance;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface DiscoveryQuery {
  market: string;
  keywords: string[];
  maxPriceUsd?: number;
  limit: number;
}

export interface TrendSignal {
  signal: string;
  value: number;
  provenance: Provenance;
  source: string;
  sourceUrl?: string;
  meta?: Record<string, unknown>;
}

export type Credentials = Record<string, string>;

export interface SourceAdapter {
  key: SourceAdapterKey;
  label: string;
  kind: "supplier" | "affiliate" | "marketplace" | "trend" | "manual" | "demo";
  /** Uses an official, documented API (FORGE never scrapes in violation of platform terms). */
  officialApi: boolean;
  docsUrl: string;
  /** Exactly what an operator must provide / obtain to enable this adapter. */
  requirements: string[];
  /** "implemented" = working code path; "interface" = setup state + contract only (needs an approved app / paid access). */
  implementation: "implemented" | "interface";
  notes?: string;
  isConfigured(creds: Credentials, config: Record<string, unknown>): boolean;
  discover?(query: DiscoveryQuery, creds: Credentials, config: Record<string, unknown>): Promise<DiscoveredProduct[]>;
  signals?(keyword: string, creds: Credentials): Promise<TrendSignal[]>;
}
