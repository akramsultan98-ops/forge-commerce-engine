// Amazon marketplaces FORGE supports, from the Creators API locale reference. Egypt first; add a
// marketplace here (with its own Associates account and tag) to support another.

import type { AffiliateMarketplace } from "../types";

export interface AmazonMarketplace extends AffiliateMarketplace {
  /** Sent as `marketplace` and in the `x-marketplace` header. */
  host: string;
  /** Associates tracking tags for this marketplace end with this suffix. */
  tagSuffix: string;
  /** Credential region expected for this marketplace (the version Amazon issues is authoritative). */
  region: "NA" | "EU" | "FE";
}

export const AMAZON_MARKETPLACES: Record<string, AmazonMarketplace> = {
  "www.amazon.eg": {
    id: "www.amazon.eg",
    host: "www.amazon.eg",
    country: "EG",
    name: "Amazon.eg",
    currency: "EGP",
    languages: ["en_AE", "ar_AE"],
    defaultLanguage: "en_AE",
    tagSuffix: "-21",
    // Middle-East marketplaces (amazon.sa, amazon.ae) use the Europe credential region; Egypt is assumed to as well.
    region: "EU",
    categories: [
      "All",
      "ArtsAndCrafts",
      "Automotive",
      "Baby",
      "Beauty",
      "Books",
      "Electronics",
      "Fashion",
      "Garden",
      "Grocery",
      "HealthPersonalCare",
      "Home",
      "HomeImprovement",
      "Industrial",
      "MusicalInstruments",
      "OfficeProducts",
      "PetSupplies",
      "Software",
      "SportsAndOutdoors",
      "Toys",
      "VideoGames",
    ],
  },
};

export const DEFAULT_AMAZON_MARKETPLACE = "www.amazon.eg";
