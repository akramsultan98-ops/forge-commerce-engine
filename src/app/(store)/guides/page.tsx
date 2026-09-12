import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatDate } from "@/lib/utils";
import { getI18n } from "@/i18n/server";
import { publishedArticles } from "@/server/services/storefront";
import { Tracker } from "@/components/store/client";

export const metadata: Metadata = { title: "Guides", description: "Honest, signal-based product round-ups — with the watch-outs included.", alternates: { canonical: "/guides" } };

export default async function GuidesPage() {
  const { t, locale } = await getI18n();
  const items = await publishedArticles(50);
  return (
    <div className="mx-auto max-w-[1200px] px-5 pt-14 md:px-10 md:pt-20">
      <Suspense>
        <Tracker />
      </Suspense>
      <header className="max-w-3xl border-b border-ink pb-10">
        <p className="eyebrow text-muted">{t("nav.guides")}</p>
        <h1 className="mt-4 font-display text-6xl leading-[0.95] text-ink md:text-7xl">{t("listing.guidesTitle")}</h1>
        <p className="mt-5 text-lg leading-relaxed text-muted">{t("listing.guidesSub")}</p>
      </header>
      {items.length ? (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id}>
              <Link href={`/guides/${a.slug}`} className="group grid gap-4 py-10 md:grid-cols-12">
                <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted md:col-span-3">
                  {a.type.replace("_", " ").toLowerCase()} · {a.publishedAt ? formatDate(a.publishedAt, locale) : ""}
                </span>
                <div className="md:col-span-9">
                  <h2 className="font-display text-4xl leading-tight text-ink group-hover:underline group-hover:decoration-line group-hover:underline-offset-8">{a.title}</h2>
                  {a.excerpt && <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">{a.excerpt}</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-16 text-muted">{t("listing.empty")}</p>
      )}
    </div>
  );
}
