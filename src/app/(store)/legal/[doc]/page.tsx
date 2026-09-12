import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getI18n } from "@/i18n/server";
import { LEGAL, LEGAL_UPDATED, type LegalDoc } from "@/content/legal";
import { storefront } from "@/server/services/storefront";

type Params = { params: Promise<{ doc: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { doc } = await params;
  const d = LEGAL[doc as LegalDoc];
  return d ? { title: d.title, alternates: { canonical: `/legal/${doc}` } } : { title: "Not found", robots: { index: false } };
}

export default async function LegalPage({ params }: Params) {
  const { doc } = await params;
  const d = LEGAL[doc as LegalDoc];
  if (!d) notFound();
  const { t, locale } = await getI18n();
  const { settings } = await storefront();
  return (
    <article className="mx-auto max-w-[760px] px-5 pt-14 md:pt-20">
      <p className="eyebrow text-muted">{t("footer.legal")}</p>
      <h1 className="mt-4 font-display text-5xl leading-none text-ink md:text-6xl">{d.title}</h1>
      <p className="mt-4 text-sm text-muted">
        {t("legal.updated")}: {LEGAL_UPDATED}
      </p>
      {locale === "ar" && <p className="mt-4 rounded-[2px] border border-line p-3 text-sm text-ink-2">النص القانوني متوفر حاليًا باللغة الإنجليزية فقط إلى حين مراجعة الترجمة قانونيًا.</p>}
      <div className="mt-10 space-y-10 border-t border-ink pt-10" lang="en" dir="ltr">
        {d.sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-xl font-medium text-ink">{s.h}</h2>
            {s.p.map((para, i) => (
              <p key={i} className="mt-3 text-[15px] leading-[1.75] text-ink-2">
                {para}
              </p>
            ))}
          </section>
        ))}
        {doc === "affiliate-disclosure" && <p className="text-[15px] leading-[1.75] text-ink-2">{settings.affiliateDisclosure}</p>}
        {settings.contactEmail && <p className="text-sm text-muted">Contact: {settings.contactEmail}</p>}
      </div>
    </article>
  );
}
