import Link from "next/link";
import { Suspense } from "react";
import { getDisplayCurrency, getI18n } from "@/i18n/server";
import { publicProducts, storefront } from "@/server/services/storefront";
import { latestScores } from "@/server/services/scoring";
import { FACTOR_META, SCORING_FACTORS } from "@/domain/scoring";
import { ProductVisual } from "@/components/ProductVisual";
import { ProductCard, SectionHead, priceLabel } from "@/components/store/ProductCard";
import { NewsletterForm, Tracker } from "@/components/store/client";
import { subscribeAction } from "./actions";

export default async function HomePage() {
  const { t, locale } = await getI18n();
  const { db, org, rates } = await storefront();
  const display = await getDisplayCurrency(org.defaultCurrency);
  const [top, trending, problem, under50, viral, editors, all] = await Promise.all([
    publicProducts({ sort: "score", limit: 4 }),
    publicProducts({ sort: "trend", limit: 4 }),
    publicProducts({ sort: "problem", limit: 5 }),
    publicProducts({ sort: "score", maxPrice: 50, limit: 4 }),
    publicProducts({ sort: "content", limit: 4 }),
    publicProducts({ statuses: ["WINNER", "SCALING"], sort: "score", limit: 2 }),
    publicProducts({ limit: 200 }),
  ]);
  const hero = top[0];
  const scores = await latestScores({ db }, [...top, ...editors].map((p) => p.id));
  const heroScore = hero ? scores.get(hero.id) : undefined;
  const card = { display, rates, locale, scoreLabel: t("product.score") };
  const provLabel = (p: string) => t(`provenance.${p}`);

  return (
    <>
      <Suspense>
        <Tracker />
      </Suspense>

      {/* Hero */}
      <section className="mx-auto max-w-[1400px] px-5 pt-14 md:px-10 md:pt-24">
        <div className="grid gap-14 md:grid-cols-12 md:items-end">
          <div className="animate-rise md:col-span-7">
            <p className="eyebrow mb-7 text-muted">{t("home.heroEyebrow")}</p>
            <h1 className="text-balance font-display text-[clamp(3.4rem,9.5vw,8.75rem)] leading-[0.88] tracking-[-0.03em] text-ink">{t("home.heroTitle")}</h1>
            <p className="mt-9 max-w-xl text-lg leading-relaxed text-ink-2 md:text-xl">{t("home.heroSub")}</p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/products" className="inline-flex h-12 items-center rounded-full bg-ink px-7 text-[15px] text-paper transition-opacity hover:opacity-85">
                {t("home.ctaExplore")}
              </Link>
              <Link href="/trending" className="inline-flex h-12 items-center rounded-full border border-ink/20 px-7 text-[15px] text-ink transition-colors hover:border-ink">
                {t("home.ctaTrending")}
              </Link>
            </div>
          </div>
          {hero && (
            <div className="animate-rise md:col-span-5" style={{ animationDelay: "140ms" }}>
              <Link href={`/products/${hero.slug}`} className="group block">
                <div className="overflow-hidden">
                  <ProductVisual title={hero.title} slug={hero.slug} imageUrl={hero.imageUrl} categoryName={hero.categoryName} categoryIcon={hero.categoryIcon} index={1} eager className="aspect-[4/5] w-full transition-transform duration-700 group-hover:scale-[1.02]" />
                </div>
                <div className="mt-4 flex items-baseline justify-between gap-4 border-t border-ink pt-3">
                  <p className="text-[15px] text-ink">{hero.title}</p>
                  <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                    {t("product.score")} {hero.overallScore !== null ? Math.round(hero.overallScore) : "—"}
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
        <dl className="mt-20 grid grid-cols-2 gap-y-6 border-y border-line py-6 md:grid-cols-4">
          {[
            [String(all.length), t("home.statProducts")],
            ["9", t("home.statFactors")],
            ["5", t("home.statProvenance")],
            ["0", t("home.statFake")],
          ].map(([n, label]) => (
            <div key={label} className="flex items-baseline gap-3 pe-4">
              <dt className="order-2 text-sm text-muted">{label}</dt>
              <dd className="font-display text-4xl leading-none text-ink">{n}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Trending */}
      {trending.length > 0 && (
        <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
          <SectionHead eyebrow="01" title={t("home.trending")} sub={t("home.trendingSub")} href="/trending" viewAll={t("home.viewAll")} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-4">
            {trending.map((p, i) => (
              <ProductCard key={p.id} p={p} index={i + 1} {...card} note={p.trendScore !== null ? `Trend index ${Math.round(p.trendScore)} · ${provLabel(p.fieldProvenance?.trendScore?.p ?? "MISSING")}` : undefined} />
            ))}
          </div>
        </section>
      )}

      {/* Top picks */}
      {top.length > 1 && (
        <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
          <SectionHead eyebrow="02" title={t("home.topPicks")} sub={t("home.topPicksSub")} href="/best-products" viewAll={t("home.viewAll")} />
          <div className="grid gap-x-6 gap-y-14 md:grid-cols-3">
            {top.slice(1, 4).map((p, i) => (
              <ProductCard key={p.id} p={p} index={i + 2} {...card} size="lg" note={scores.get(p.id)?.reasons[0]} />
            ))}
          </div>
        </section>
      )}

      {/* Problem solvers — editorial list */}
      {problem.length > 0 && (
        <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
          <SectionHead eyebrow="03" title={t("home.problemSolvers")} sub={t("home.problemSolversSub")} />
          <ol className="divide-y divide-line border-b border-line">
            {problem.map((p, i) => (
              <li key={p.id}>
                <Link href={`/products/${p.slug}`} className="group grid items-center gap-4 py-6 md:grid-cols-12">
                  <span className="font-mono text-xs text-muted md:col-span-1">N° {String(i + 1).padStart(2, "0")}</span>
                  <span className="md:col-span-6">
                    <span className="eyebrow block text-muted">{t("home.problemLabel")}</span>
                    <span className="mt-1 block font-display text-2xl italic leading-tight text-ink md:text-3xl">{p.problemSolved ? `${p.problemSolved[0].toUpperCase()}${p.problemSolved.slice(1)}.` : p.title}</span>
                  </span>
                  <span className="flex items-center justify-between gap-4 md:col-span-5">
                    <span className="text-[15px] text-ink-2">{p.title}</span>
                    <span aria-hidden className="text-xl text-ink transition-transform group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Under $50 */}
      {under50.length > 0 && (
        <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
          <SectionHead eyebrow="04" title={t("home.under50")} sub={t("home.under50Sub")} href="/products" viewAll={t("home.viewAll")} />
          <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-4">
            {under50.map((p, i) => (
              <ProductCard key={p.id} p={p} index={i + 1} {...card} />
            ))}
          </div>
        </section>
      )}

      {/* Viral potential */}
      {viral.length > 0 && (
        <section className="mt-28 bg-paper-2 py-24">
          <div className="mx-auto max-w-[1400px] px-5 md:px-10">
            <SectionHead eyebrow="05" title={t("home.viral")} sub={t("home.viralSub")} />
            <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-4">
              {viral.map((p, i) => (
                <ProductCard key={p.id} p={p} index={i + 1} {...card} note={p.contentScore !== null ? `Content potential ${Math.round(p.contentScore)}` : undefined} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Editor's picks */}
      {editors.length > 0 && (
        <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
          <SectionHead eyebrow="06" title={t("home.editors")} sub={t("home.editorsSub")} />
          <div className="grid gap-10 md:grid-cols-2">
            {editors.map((p, i) => (
              <Link key={p.id} href={`/products/${p.slug}`} className="group grid gap-6 sm:grid-cols-2">
                <div className="overflow-hidden">
                  <ProductVisual title={p.title} slug={p.slug} imageUrl={p.imageUrl} categoryName={p.categoryName} categoryIcon={p.categoryIcon} index={i + 1} className="aspect-[4/5] w-full transition-transform duration-700 group-hover:scale-[1.02]" />
                </div>
                <div className="flex flex-col justify-between border-t border-ink pt-4">
                  <div>
                    <p className="eyebrow text-muted">{p.categoryName}</p>
                    <h3 className="mt-3 font-display text-4xl leading-[1.02] text-ink">{p.title}</h3>
                    <ul className="mt-5 space-y-2 text-sm text-ink-2">
                      {(scores.get(p.id)?.reasons ?? []).slice(0, 3).map((r) => (
                        <li key={r} className="flex gap-2">
                          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink" />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <p className="mt-6 flex items-baseline justify-between text-sm">
                    <span className="tabular text-ink">{priceLabel(p, display, rates, locale)}</span>
                    <span className="underline decoration-line underline-offset-[6px] group-hover:decoration-ink">{t("product.viewProduct")}</span>
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* How FORGE works */}
      <section id="how" className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
        <SectionHead eyebrow="07" title={t("home.howTitle")} />
        <ol className="grid gap-10 md:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <li key={n} className="border-t border-line pt-5">
              <span className="font-mono text-xs text-muted">0{n}</span>
              <h3 className="mt-4 text-xl font-medium text-ink">{t(`home.how${n}Title`)}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-muted">{t(`home.how${n}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Product intelligence — show the real score breakdown of the top product */}
      {hero && heroScore && (
        <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
          <div className="grid gap-12 border-t border-ink pt-10 md:grid-cols-12">
            <div className="md:col-span-5">
              <p className="eyebrow text-muted">08</p>
              <h2 className="mt-3 font-display text-5xl leading-[1.0] text-ink">{t("home.intelTitle")}</h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">{t("home.intelSub")}</p>
              <Link href={`/products/${hero.slug}`} className="mt-8 inline-flex text-sm text-ink underline decoration-line underline-offset-[6px] hover:decoration-ink">
                {hero.title} — {t("product.scoreBreakdown")}
              </Link>
            </div>
            <div className="md:col-span-7">
              <div className="mb-6 flex items-baseline justify-between border-b border-line pb-4">
                <span className="text-sm text-muted">{hero.title}</span>
                <span className="font-display text-6xl leading-none text-ink">{Math.round(heroScore.overall)}</span>
              </div>
              <ul className="space-y-3.5">
                {SCORING_FACTORS.map((f) => {
                  const fr = heroScore.factors[f];
                  if (!fr) return null;
                  return (
                    <li key={f} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-4 text-sm">
                      <span className="truncate text-ink-2">{FACTOR_META[f].label}</span>
                      <span className="flex h-3 items-center">
                        <span className="block h-1.5 rounded-e-[4px] bg-ink" style={{ width: `${Math.max(2, fr.score)}%` }} />
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="tabular w-7 text-end text-ink">{Math.round(fr.score)}</span>
                        <span className="w-28 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{provLabel(fr.provenance)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
        <SectionHead eyebrow="09" title={t("home.faqTitle")} />
        <div className="grid gap-x-12 md:grid-cols-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <details key={n} className="group border-b border-line py-5">
              <summary className="flex items-center justify-between gap-6 text-[17px] text-ink">
                {t(`home.faq${n}q`)}
                <span aria-hidden className="text-xl leading-none text-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">{t(`home.faq${n}a`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Product alerts */}
      <section className="mx-auto mt-28 max-w-[1400px] px-5 md:px-10">
        <div className="grid gap-10 rounded-[2px] bg-paper-2 px-6 py-14 md:grid-cols-2 md:items-center md:px-14">
          <div>
            <h2 className="font-display text-5xl leading-none text-ink">{t("home.alertsTitle")}</h2>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">{t("home.alertsSub")}</p>
          </div>
          <NewsletterForm action={subscribeAction} placeholder={t("newsletter.placeholder")} submit={t("newsletter.submit")} consent={t("newsletter.consent")} source="home" />
        </div>
      </section>
    </>
  );
}
