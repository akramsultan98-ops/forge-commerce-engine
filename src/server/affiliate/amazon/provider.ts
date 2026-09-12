// Amazon Associates provider (Creators API). Everything Amazon-specific lives in this folder; the
// rest of FORGE only sees AffiliateProductInput. No scraping: data comes from the official API or not at all.

import { AMAZON_MAX_DATA_AGE_HOURS } from "@/domain/affiliate-products";
import type { AffiliateAvailability } from "@/lib/constants";
import { ValidationError } from "../../errors";
import type { AffiliateProductInput, AffiliateProvider, ProviderError, ProviderResult, ProviderSearch } from "../types";
import { creatorsApi } from "./client";
import { amazonConfig, amazonConfigStatus } from "./config";
import { AMAZON_MARKETPLACES, type AmazonMarketplace } from "./marketplaces";

/** Only what FORGE shows or reviews. The Creators API offers no customer-review data, so none is requested. */
export const CREATORS_RESOURCES = [
  "itemInfo.title",
  "itemInfo.byLineInfo",
  "itemInfo.features",
  "itemInfo.classifications",
  "images.primary.large",
  "images.variants.large",
  "offersV2.listings.price",
  "offersV2.listings.availability",
  "offersV2.listings.merchantInfo",
  "offersV2.listings.isBuyBoxWinner",
  "browseNodeInfo.browseNodes",
  "browseNodeInfo.browseNodes.ancestor",
  "browseNodeInfo.browseNodes.salesRank",
  "browseNodeInfo.websiteSalesRank",
  "parentASIN",
] as const;

const ASIN = /^[A-Z0-9]{10}$/;

type Money = { amount?: unknown; currency?: unknown; displayAmount?: unknown };
type ImageSet = { large?: { url?: unknown }; medium?: { url?: unknown } };
type Display = { displayValue?: unknown };
type BrowseNode = { displayName?: unknown; salesRank?: unknown; ancestor?: BrowseNode };
export interface CreatorsItem {
  asin?: unknown;
  parentASIN?: unknown;
  detailPageURL?: unknown;
  images?: { primary?: ImageSet; variants?: ImageSet[] };
  itemInfo?: {
    title?: Display;
    features?: { displayValues?: unknown[] };
    byLineInfo?: { brand?: Display; manufacturer?: Display };
    classifications?: { productGroup?: Display; binding?: Display };
  };
  offersV2?: { listings?: Array<{ price?: Money & { money?: Money }; availability?: { type?: unknown; message?: unknown }; merchantInfo?: { name?: unknown }; isBuyBoxWinner?: unknown }> };
  browseNodeInfo?: { browseNodes?: BrowseNode[]; websiteSalesRank?: { salesRank?: unknown } };
}
interface CreatorsResponse {
  itemsResult?: { items?: unknown[] };
  itemResults?: { items?: unknown[] };
  searchResult?: { items?: unknown[] };
  errors?: unknown;
}

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** An https URL (optionally on one host), else null. */
const httpsUrl = (v: unknown, host?: string) => {
  const s = str(v, 2048);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && (!host || u.hostname === host) ? u.toString() : null;
  } catch {
    return null;
  }
};
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n)));

export function mapAvailability(type: string | null): AffiliateAvailability {
  const t = (type ?? "").toUpperCase();
  if (!t) return "UNKNOWN";
  if (/OUT_OF_STOCK|UNAVAILABLE/.test(t)) return "OUT_OF_STOCK";
  if (/PRE_?ORDER|AVAILABLE_DATE/.test(t)) return "PREORDER";
  if (/BACK_?ORDER|LEAD_?TIME/.test(t)) return "BACKORDER";
  if (/IN_STOCK|^NOW$|AVAILABLE/.test(t)) return "IN_STOCK";
  return "UNKNOWN";
}

/** Browse-node ancestry, root first (e.g. ["Kitchen & Dining", "Food Storage", "Lids"]). */
function categoryPath(node: BrowseNode | undefined): string[] {
  const names: string[] = [];
  for (let n = node, depth = 0; n && depth < 10; n = n.ancestor, depth++) {
    const name = str(n.displayName, 120);
    if (name) names.push(name);
  }
  return names.reverse();
}

/** Creators API item → the network-agnostic listing. Null when Amazon returned no usable ASIN or title. */
export function normalizeAmazonItem(item: CreatorsItem, mp: AmazonMarketplace, fetchedAt: Date): AffiliateProductInput | null {
  const asin = str(item.asin, 20)?.toUpperCase() ?? null;
  const title = str(item.itemInfo?.title?.displayValue, 500);
  if (!asin || !ASIN.test(asin) || !title) return null;
  const info = item.itemInfo ?? {};
  const listings = item.offersV2?.listings ?? [];
  const listing = listings.find((l) => l.isBuyBoxWinner === true) ?? listings[0];
  const money = listing?.price?.money ?? listing?.price;
  const amount = num(money?.amount);
  const currency = str(money?.currency, 3);
  const nodes = item.browseNodeInfo?.browseNodes ?? [];
  const path = categoryPath(nodes[0]);
  const images = [item.images?.primary, ...(item.images?.variants ?? [])].map((set) => httpsUrl(set?.large?.url ?? set?.medium?.url)).filter((u): u is string => !!u);
  const features = (info.features?.displayValues ?? []).map((f) => str(f)).filter((f): f is string => !!f).slice(0, 20);
  const priced = amount !== null && !!currency;
  return {
    network: "AMAZON_ASSOCIATES",
    marketplace: mp.id,
    country: mp.country,
    externalId: asin,
    externalIdType: "ASIN",
    parentExternalId: str(item.parentASIN, 20),
    merchant: str(listing?.merchantInfo?.name, 120) ?? mp.name,
    title,
    description: null, // the Creators API supplies features, not a long description
    features,
    category: path.at(-1) ?? str(info.classifications?.productGroup?.displayValue, 200),
    categoryPath: path,
    brand: str(info.byLineInfo?.brand?.displayValue, 120) ?? str(info.byLineInfo?.manufacturer?.displayValue, 120),
    productUrl: `https://${mp.host}/dp/${asin}`,
    affiliateUrl: httpsUrl(item.detailPageURL, mp.host), // tagged detail-page link as returned by Amazon
    imageUrls: [...new Set(images)].slice(0, 10), // links to Amazon-hosted images only — never copied
    price: priced ? amount : null,
    currency: priced ? currency : null,
    priceDisplay: str(money?.displayAmount, 40),
    availability: mapAvailability(str(listing?.availability?.type, 60)),
    availabilityMessage: str(listing?.availability?.message, 300),
    rating: null,
    reviewCount: null,
    reviewSource: null,
    commissionRate: null,
    networkMeta: {
      isBuyBoxWinner: listing?.isBuyBoxWinner === true,
      offerCount: listings.length,
      salesRank: num(nodes[0]?.salesRank),
      websiteSalesRank: num(item.browseNodeInfo?.websiteSalesRank?.salesRank),
    },
    fetchedAt,
    provenance: "REAL",
  };
}

function toErrors(raw: unknown): ProviderError[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: { code?: unknown; message?: unknown }) => {
    const message = str(e?.message, 300) ?? "Amazon reported an error";
    return { id: message.match(/\b([A-Z0-9]{10})\b/)?.[1], code: str(e?.code, 80) ?? "AmazonError", message };
  });
}

function collect(items: unknown[], errors: unknown, mp: AmazonMarketplace, fetchedAt = new Date()): ProviderResult {
  const out: ProviderResult = { items: [], errors: toErrors(errors) };
  for (const raw of items) {
    const item = raw as CreatorsItem;
    const normalized = normalizeAmazonItem(item, mp, fetchedAt);
    if (normalized) out.items.push(normalized);
    else out.errors.push({ id: str(item?.asin, 20) ?? undefined, code: "IncompleteItem", message: "Amazon returned an item without a valid ASIN or title" });
  }
  return out;
}

export const amazonProvider: AffiliateProvider = {
  network: "AMAZON_ASSOCIATES",
  label: "Amazon Associates — Creators API",
  docsUrl: "https://affiliate-program.amazon.com/creatorsapi/docs",
  externalIdType: "ASIN",
  maxDataAgeHours: AMAZON_MAX_DATA_AGE_HOURS,

  marketplaces: () => Object.values(AMAZON_MARKETPLACES),

  status() {
    const s = amazonConfigStatus();
    return { configured: s.configured, marketplace: s.marketplace, missing: s.missing, problems: s.problems, warnings: s.warnings };
  },

  /**
   * Associates Program Policies: prices and availability shown with their date/time and Amazon's
   * statement; the Associates disclosure wherever Special Links appear; prices exactly as Amazon
   * returns them. Prices stay out of JSON-LD because crawlers keep copies beyond the 24-hour limit.
   */
  storefrontPolicy(marketplace: string) {
    const name = AMAZON_MARKETPLACES[marketplace]?.name ?? "Amazon";
    return {
      ctaLabel: `View on ${name}`,
      priceDisclaimer: `Product prices and availability are accurate as of the date/time indicated and are subject to change. Any price and availability information displayed on ${name} at the time of purchase will apply to the purchase of this product.`,
      disclosure: "As an Amazon Associate we earn from qualifying purchases.",
      structuredDataPrice: false,
      convertPrices: false,
    };
  },

  async search(q: ProviderSearch) {
    const cfg = amazonConfig(q.marketplace);
    const mp = cfg.marketplace;
    const keywords = q.keywords.trim();
    if (keywords.length < 2 || keywords.length > 200) throw new ValidationError("keywords must be 2–200 characters");
    const searchIndex = q.category ?? "All";
    if (!mp.categories.includes(searchIndex)) throw new ValidationError(`Unknown category "${searchIndex}" for ${mp.name} — use one of: ${mp.categories.join(", ")}`);
    const json = await creatorsApi<CreatorsResponse>(cfg, "searchItems", {
      keywords,
      searchIndex,
      itemCount: clamp(q.limit ?? 10, 1, 10),
      itemPage: clamp(q.page ?? 1, 1, 10),
      partnerTag: cfg.partnerTag,
      marketplace: mp.host,
      languagesOfPreference: [mp.defaultLanguage],
      resources: [...CREATORS_RESOURCES],
    });
    return collect(json.searchResult?.items ?? [], json.errors, mp);
  },

  async getItems(marketplace: string, externalIds: string[]) {
    const cfg = amazonConfig(marketplace);
    const mp = cfg.marketplace;
    const wanted = [...new Set(externalIds.map((id) => id.trim().toUpperCase()))];
    const valid = wanted.filter((id) => ASIN.test(id));
    const result: ProviderResult = { items: [], errors: wanted.filter((id) => !ASIN.test(id)).map((id) => ({ id, code: "InvalidASIN", message: "Not a valid ASIN" })) };
    for (let i = 0; i < valid.length; i += 10) {
      const chunk = valid.slice(i, i + 10);
      const json = await creatorsApi<CreatorsResponse>(cfg, "getItems", {
        itemIds: chunk,
        itemIdType: "ASIN",
        partnerTag: cfg.partnerTag,
        marketplace: mp.host,
        languagesOfPreference: [mp.defaultLanguage],
        resources: [...CREATORS_RESOURCES],
      });
      const part = collect((json.itemsResult ?? json.itemResults)?.items ?? [], json.errors, mp);
      result.items.push(...part.items);
      result.errors.push(...part.errors);
      const seen = new Set<string>([...part.items.map((x) => x.externalId), ...part.errors.flatMap((e) => (e.id ? [e.id] : []))]);
      for (const id of chunk) if (!seen.has(id)) result.errors.push({ id, code: "NotReturned", message: "Amazon returned no data for this ASIN" });
    }
    return result;
  },
};
