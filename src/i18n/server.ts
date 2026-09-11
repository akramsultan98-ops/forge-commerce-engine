import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { CURRENCIES, type Currency, type Locale } from "@/lib/constants";
import { CURRENCY_COOKIE, LOCALE_COOKIE, dirFor, isLocale, makeT } from "./index";

export const getLocale = cache(async (): Promise<Locale> => {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(c)) return c;
  const accept = (await headers()).get("accept-language") ?? "";
  if (/^ar\b/i.test(accept.trim())) return "ar";
  const fallback = process.env.DEFAULT_LOCALE;
  return isLocale(fallback) ? fallback : "en";
});

export const getI18n = cache(async () => {
  const locale = await getLocale();
  return { locale, dir: dirFor(locale), t: makeT(locale) };
});

export const getDisplayCurrency = cache(async (fallback: string = "USD"): Promise<Currency> => {
  const c = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return ((CURRENCIES as readonly string[]).includes(c ?? "") ? c : (CURRENCIES as readonly string[]).includes(fallback) ? fallback : "USD") as Currency;
});
