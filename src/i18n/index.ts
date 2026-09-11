// Client-safe i18n core: dictionaries, lookup and interpolation.
import { LOCALES, RTL_LOCALES, type Locale } from "@/lib/constants";
import { ar } from "./ar";
import { en, type Messages } from "./en";

export const MESSAGES: Record<Locale, Messages> = { en, ar };
export const LOCALE_COOKIE = "forge_locale";
export const CURRENCY_COOKIE = "forge_currency";

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

export function dirFor(locale: Locale): "rtl" | "ltr" {
  return RTL_LOCALES.includes(locale) ? "rtl" : "ltr";
}

function lookup(obj: unknown, key: string): string | undefined {
  let cur: unknown = obj;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof cur === "string" ? cur : undefined;
}

export type TFunction = (key: string, vars?: Record<string, string | number>) => string;

/** t("home.heroTitle") with {var} interpolation; falls back to English, then the key itself. */
export function makeT(locale: Locale): TFunction {
  return (key, vars) => {
    let s = lookup(MESSAGES[locale], key) ?? lookup(MESSAGES.en, key) ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
