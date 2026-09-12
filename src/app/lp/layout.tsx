import Link from "next/link";
import { getI18n } from "@/i18n/server";
import { storefront } from "@/server/services/storefront";

/** Standalone landing pages: minimal chrome (fewer exits), full legal links and disclosure. */
export default async function LandingLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getI18n();
  const { settings } = await storefront();
  return (
    <div className="store min-h-screen bg-paper text-ink [color-scheme:light]">
      <header className="mx-auto flex h-16 max-w-[1200px] items-center px-5 md:px-10">
        <Link href="/" className="text-[15px] font-semibold tracking-[0.34em] text-ink">
          {settings.name.toUpperCase()}
        </Link>
      </header>
      <main>{children}</main>
      <footer className="mx-auto mt-16 max-w-[1200px] border-t border-line px-5 py-10 text-xs text-muted md:px-10">
        <p className="max-w-3xl leading-relaxed">{settings.affiliateDisclosure}</p>
        <nav aria-label="Legal" className="mt-5 flex flex-wrap gap-5">
          {(["privacy", "terms", "cookies", "returns", "affiliate"] as const).map((k) => (
            <Link key={k} href={`/legal/${k === "affiliate" ? "affiliate-disclosure" : k}`} className="hover:text-ink">
              {t(`footer.${k}`)}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
