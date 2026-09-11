import Link from "next/link";
import { Suspense } from "react";
import { CURRENCIES } from "@/lib/constants";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { storefront } from "@/server/services/storefront";
import { CookieBanner } from "@/components/store/client";
import { consentAction, setCurrencyAction, setLocaleAction } from "./actions";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { t, locale } = await getI18n();
  const { org, settings } = await storefront();
  const currency = await getDisplayCurrency(org.defaultCurrency);
  const nav = [
    { href: "/products", label: t("nav.products") },
    { href: "/trending", label: t("nav.trending") },
    { href: "/best-products", label: t("nav.best") },
    { href: "/guides", label: t("nav.guides") },
  ];
  return (
    <div className="store flex min-h-screen flex-col bg-paper text-ink [color-scheme:light]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-5 md:px-10">
          <Link href="/" className="text-[15px] font-semibold tracking-[0.34em] text-ink" aria-label={`${settings.name} — home`}>
            {settings.name.toUpperCase()}
          </Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm text-ink-2 transition-colors hover:text-ink">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <form action={setCurrencyAction} className="hidden sm:block">
              <label htmlFor="currency" className="sr-only">
                {t("nav.currency")}
              </label>
              <select id="currency" name="currency" defaultValue={currency} className="h-8 rounded-full border border-line bg-transparent px-2.5 text-xs text-ink-2 hover:border-ink">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button type="submit" className="ms-1 h-8 rounded-full border border-line px-2.5 text-xs text-ink-2 hover:border-ink">
                ✓<span className="sr-only">Apply currency</span>
              </button>
            </form>
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale === "ar" ? "en" : "ar"} />
              <button type="submit" className="h-8 rounded-full border border-line px-3 text-xs text-ink-2 hover:border-ink" lang={locale === "ar" ? "en" : "ar"}>
                {t("nav.language")}
              </button>
            </form>
            <details className="relative md:hidden">
              <summary className="grid h-8 w-8 place-items-center rounded-full border border-line" aria-label={t("nav.menu")}>
                <span aria-hidden className="block h-px w-3.5 bg-ink shadow-[0_4px_0_0_var(--color-ink),0_-4px_0_0_var(--color-ink)]" />
              </summary>
              <nav aria-label="Mobile" className="absolute end-0 top-11 w-56 rounded-xl border border-line bg-paper p-2 shadow-xl">
                {nav.map((n) => (
                  <Link key={n.href} href={n.href} className="block rounded-lg px-3 py-2.5 text-sm hover:bg-paper-2">
                    {n.label}
                  </Link>
                ))}
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>

      <footer className="mt-24 bg-ink text-paper">
        <div className="mx-auto max-w-[1400px] px-5 pb-10 pt-16 md:px-10">
          <div className="grid gap-12 md:grid-cols-12">
            <div className="md:col-span-5">
              <p className="font-display text-6xl leading-none tracking-tight md:text-7xl">{settings.name}</p>
              <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/60">{t("footer.about")}</p>
            </div>
            <nav aria-label="Discover" className="md:col-span-3">
              <p className="eyebrow mb-4 text-white/45">{t("nav.products")}</p>
              <ul className="space-y-2.5 text-sm">
                {nav.map((n) => (
                  <li key={n.href}>
                    <Link href={n.href} className="text-white/80 hover:text-white">
                      {n.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <nav aria-label="Legal" className="md:col-span-4">
              <p className="eyebrow mb-4 text-white/45">{t("footer.legal")}</p>
              <ul className="space-y-2.5 text-sm">
                {(["privacy", "terms", "cookies", "returns", "affiliate"] as const).map((k) => (
                  <li key={k}>
                    <Link href={`/legal/${k === "affiliate" ? "affiliate-disclosure" : k}`} className="text-white/80 hover:text-white">
                      {t(`footer.${k}`)}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <p className="mt-14 max-w-3xl border-t border-white/15 pt-6 text-xs leading-relaxed text-white/50">{settings.affiliateDisclosure}</p>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 text-xs text-white/40">
            <span>
              © {new Date().getFullYear()} {settings.name}. {t("footer.rights")}
            </span>
            <Link href="/admin/login" className="hover:text-white/70">
              {t("footer.admin")}
            </Link>
          </div>
        </div>
      </footer>
      <Suspense>
        <CookieBanner text={t("cookie.text")} accept={t("cookie.accept")} decline={t("cookie.decline")} more={t("cookie.more")} onChoice={consentAction} />
      </Suspense>
    </div>
  );
}
