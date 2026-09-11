// Attribution helpers — UTM construction/parsing and network sub-id handling.

export interface UtmParams {
  source: string;
  medium: string;
  campaign: string;
  content?: string | null;
  term?: string | null;
}

export const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export function normalizeUtmValue(v: string): string {
  return v
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

/** Adds (or replaces) UTM parameters on a URL, preserving any existing query string and hash. */
export function buildUtmUrl(base: string, p: UtmParams): string {
  const url = new URL(base);
  url.searchParams.set("utm_source", normalizeUtmValue(p.source));
  url.searchParams.set("utm_medium", normalizeUtmValue(p.medium));
  url.searchParams.set("utm_campaign", normalizeUtmValue(p.campaign));
  if (p.content) url.searchParams.set("utm_content", normalizeUtmValue(p.content));
  if (p.term) url.searchParams.set("utm_term", normalizeUtmValue(p.term));
  return url.toString();
}

export function parseUtm(search: URLSearchParams): Partial<Record<(typeof UTM_KEYS)[number], string>> {
  const out: Partial<Record<(typeof UTM_KEYS)[number], string>> = {};
  for (const k of UTM_KEYS) {
    const v = search.get(k);
    if (v) out[k] = v.slice(0, 200);
  }
  return out;
}

/** Appends our click id under the network's sub-id parameter so postbacks can be matched to the click. */
export function appendSubId(destination: string, param: string | null | undefined, value: string): string {
  if (!param) return destination;
  const url = new URL(destination);
  url.searchParams.set(param, value);
  return url.toString();
}

export const PLATFORM_UTM_SOURCE: Record<string, string> = {
  TIKTOK: "tiktok",
  INSTAGRAM: "instagram",
  YOUTUBE: "youtube",
  PINTEREST: "pinterest",
  FACEBOOK: "facebook",
  X: "x",
  EMAIL: "email",
  BLOG: "blog",
  WEB: "web",
  OTHER: "other",
};

/** utm_content id for a generated content item, e.g. video_001 / pin_004. */
export function contentUtmId(contentType: string, index: number): string {
  const prefix: Record<string, string> = {
    TIKTOK_VIDEO: "video",
    INSTAGRAM_REEL: "reel",
    YOUTUBE_SHORT: "short",
    PINTEREST_PIN: "pin",
    STATIC_POST: "static",
    CAROUSEL: "carousel",
    EDUCATIONAL_POST: "edu",
    PROBLEM_SOLUTION_POST: "ps",
    AD_CONCEPT: "ad",
    EMAIL: "email",
    ARTICLE: "article",
  };
  return `${prefix[contentType] ?? "item"}_${String(index).padStart(3, "0")}`;
}

/** Only http(s) destinations may be used for redirects (blocks javascript:, data:, etc.). */
export function isSafeRedirectUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
