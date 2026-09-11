// Client-safe utilities (no Node APIs).

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function slugify(input: string, maxLength = 80): string {
  const base = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return base || `item-${hashString(input).toString(36)}`;
}

export const clamp = (n: number, min = 0, max = 100) => Math.min(max, Math.max(min, n));
export const round = (n: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** FNV-1a 32-bit — deterministic, fast, good enough for bucketing and stable picks. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickStable<T>(items: readonly T[], seed: string): T {
  return items[hashString(seed) % items.length];
}

/** Deterministic shuffle (seeded) — used by the template engine so output is stable per product. */
export function shuffleStable<T>(items: readonly T[], seed: string): T[] {
  const arr = [...items];
  let s = hashString(seed) || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, "") + "…";
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function formatNumber(n: number | null | undefined, locale = "en", digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: digits }).format(n);
}

export function formatCompact(n: number | null | undefined, locale = "en"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatPercent(ratio: number | null | undefined, digits = 1, locale = "en"): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio) || !Number.isFinite(ratio)) return "—";
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", { style: "percent", maximumFractionDigits: digits }).format(ratio);
}

export function formatDate(d: Date | string | null | undefined, locale = "en", opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", opts).format(date);
}

export function formatRelative(d: Date | string | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (now.getTime() - date.getTime()) / 1000;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 60) return "just now";
  if (abs < 3600) return `${Math.round(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${suffix}`;
  if (abs < 86400 * 30) return `${Math.round(abs / 86400)}d ${suffix}`;
  return formatDate(date);
}

export function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number, from = new Date()): Date {
  return new Date(from.getTime() - n * 86400_000);
}
