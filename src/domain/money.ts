// Currency conversion + formatting. Rates are USD-based and configurable in Settings → Currency.

import type { Currency } from "@/lib/constants";

/**
 * Reference rates (units of currency per 1 USD) used until an operator saves their own in Settings.
 * SAR and AED are pegged; EUR/GBP/EGP float — treat these defaults as MANUAL estimates and update them.
 */
export const DEFAULT_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  EGP: 48.5,
  SAR: 3.75,
  AED: 3.6725,
};

export function convert(amount: number, from: string, to: string, rates: Record<string, number> = DEFAULT_RATES): number {
  if (from === to) return amount;
  const f = rates[from];
  const t = rates[to];
  if (!f || !t) return amount;
  return (amount / f) * t;
}

export function formatMoney(amount: number | null | undefined, currency: string, locale = "en", opts: { compact?: boolean } = {}): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  // Compact notation only helps from 1,000 up ($12.9K); below that show clean whole/cent amounts.
  const compact = opts.compact && Math.abs(amount) >= 1000;
  return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : Math.abs(amount) >= 100 && (opts.compact || amount % 1 === 0) ? 0 : 2,
  }).format(amount);
}

/** Rounds to a psychologically clean retail price (e.g. 23.40 → 24.99 → no; 23.40 → 23.99). */
export function retailRound(price: number): number {
  if (price < 10) return Math.max(0.99, Math.floor(price) + 0.99);
  if (price < 100) return Math.floor(price) + 0.99;
  return Math.round(price / 5) * 5 - 0.01;
}

/** Suggested selling price for owned-inventory models: landed cost × multiplier, rounded. */
export function suggestPrice(cost: number, shipping = 0, multiplier = 2.8): number {
  return retailRound((cost + shipping) * multiplier);
}
