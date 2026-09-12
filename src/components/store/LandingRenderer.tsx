// Renders landing-page sections in the editorial storefront style. Used by /lp/[slug],
// /products/[slug] and the admin builder preview. Never renders fake testimonials: SOCIAL_PROOF
// shows "why people are interested", or real imported reviews with attribution.

import type { SectionType } from "@/lib/constants";
import { parseSection } from "@/lib/landing-sections";
import { cn } from "@/lib/utils";
import type { ProductReview } from "@/server/db/schema";
import { ProductVisual } from "../ProductVisual";

export interface RenderSection {
  id: string;
  type: SectionType;
  enabled: boolean;
  content: Record<string, unknown>;
}

export interface RenderContext {
  title: string;
  slug: string;
  imageUrl: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  ctaHref: string | null;
  ctaLabel: string;
  unavailableLabel: string;
  priceText: string | null;
  merchantNote: string;
  sponsored: boolean;
  reviews: ProductReview[];
  preview?: boolean;
  labels: { problem: string; howItWorks: string; faq: string; shipping: string; returns: string; disclosure: string; whyInterested: string };
}

function Cta({ ctx, className, dark }: { ctx: RenderContext; className?: string; dark?: boolean }) {
  if (!ctx.ctaHref) {
    return (
      <span aria-disabled className={cn("inline-flex h-12 cursor-not-allowed items-center rounded-full px-7 text-[15px] opacity-50", dark ? "bg-paper text-ink" : "bg-ink text-paper", className)}>
        {ctx.unavailableLabel}
      </span>
    );
  }
  return (
    <a href={ctx.ctaHref} rel={ctx.sponsored ? "sponsored nofollow noopener" : "noopener"} className={cn("inline-flex h-12 items-center gap-2 rounded-full px-7 text-[15px] font-medium transition-opacity hover:opacity-85", dark ? "bg-paper text-ink" : "bg-ink text-paper", className)}>
      {ctx.ctaLabel}
      <span aria-hidden className="rtl:rotate-180">→</span>
    </a>
  );
}

function embedUrl(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return null;
}

function Media({ videoUrl, imageUrl, ctx }: { videoUrl?: string; imageUrl?: string; ctx: RenderContext }) {
  if (videoUrl) {
    const embed = embedUrl(videoUrl);
    if (embed) return <iframe src={embed} title={`${ctx.title} demo`} loading="lazy" allow="encrypted-media; picture-in-picture" allowFullScreen className="aspect-[4/5] w-full md:aspect-video" />;
    if (/^https:\/\/\S+\.(mp4|webm)(\?|$)/i.test(videoUrl)) return <video src={videoUrl} controls playsInline muted preload="metadata" className="aspect-[4/5] w-full bg-ink object-cover" />;
  }
  return <ProductVisual title={ctx.title} slug={ctx.slug} imageUrl={imageUrl || ctx.imageUrl} categoryName={ctx.categoryName} categoryIcon={ctx.categoryIcon} className="aspect-[4/5] w-full" eager />;
}

function Wrap({ children, className, tone }: { children: React.ReactNode; className?: string; tone?: "paper-2" | "ink" }) {
  return (
    <section className={cn(tone === "paper-2" && "bg-paper-2", tone === "ink" && "bg-ink text-paper")}>
      <div className={cn("mx-auto max-w-[1200px] px-5 py-20 md:px-10 md:py-24", className)}>{children}</div>
    </section>
  );
}

export function SectionView({ s, ctx }: { s: RenderSection; ctx: RenderContext }) {
  switch (s.type) {
    case "HERO": {
      const c = parseSection("HERO", s.content);
      return (
        <section className="mx-auto grid max-w-[1200px] gap-12 px-5 pb-16 pt-12 md:grid-cols-2 md:items-center md:px-10 md:pt-16">
          <div className="animate-rise">
            {c.eyebrow && <p className="eyebrow mb-5 text-muted">{c.eyebrow}</p>}
            <h1 className="text-balance font-display text-[clamp(2.75rem,6vw,5.25rem)] leading-[0.95] tracking-[-0.02em] text-ink">{c.headline || ctx.title}</h1>
            {c.subheadline && <p className="mt-6 max-w-lg text-lg leading-relaxed text-ink-2">{c.subheadline}</p>}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Cta ctx={{ ...ctx, ctaLabel: c.ctaLabel || ctx.ctaLabel }} />
              {ctx.priceText && <span className="tabular text-lg text-ink">{ctx.priceText}</span>}
            </div>
            {ctx.ctaHref && <p className="mt-3 text-xs text-muted">{ctx.merchantNote}</p>}
            {c.badges.length > 0 && (
              <ul className="mt-8 flex flex-wrap gap-2">
                {c.badges.map((b) => (
                  <li key={b} className="rounded-full border border-line px-3 py-1 text-xs text-ink-2">
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="animate-rise" style={{ animationDelay: "120ms" }}>
            <Media videoUrl={c.videoUrl} imageUrl={c.imageUrl} ctx={ctx} />
          </div>
        </section>
      );
    }
    case "PROBLEM": {
      const c = parseSection("PROBLEM", s.content);
      return (
        <Wrap tone="paper-2" className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="eyebrow text-muted">{c.title || ctx.labels.problem}</p>
          </div>
          <div className="md:col-span-7">
            <p className="font-display text-3xl leading-[1.15] text-ink md:text-4xl">{c.body}</p>
            {c.points.length > 0 && (
              <ul className="mt-8 space-y-3 border-t border-line pt-6 text-[15px] text-ink-2">
                {c.points.map((p) => (
                  <li key={p} className="flex gap-3">
                    <span aria-hidden className="text-muted">—</span>
                    {p}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Wrap>
      );
    }
    case "SOLUTION": {
      const c = parseSection("SOLUTION", s.content);
      return (
        <Wrap className="text-center">
          <p className="eyebrow text-muted">{c.title}</p>
          <p className="mx-auto mt-6 max-w-3xl text-balance font-display text-4xl leading-[1.1] text-ink md:text-5xl">{c.body}</p>
        </Wrap>
      );
    }
    case "BENEFITS":
    case "TRUST": {
      const c = parseSection(s.type, s.content);
      return (
        <Wrap>
          <h2 className="mb-12 font-display text-4xl text-ink">{c.title}</h2>
          <div className="grid gap-10 md:grid-cols-3">
            {c.items.map((it, i) => (
              <div key={i} className="border-t border-ink pt-5">
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
                <h3 className="mt-3 text-lg font-medium text-ink">{it.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{it.body}</p>
              </div>
            ))}
          </div>
        </Wrap>
      );
    }
    case "FEATURES": {
      const c = parseSection("FEATURES", s.content);
      return (
        <Wrap className="grid gap-10 md:grid-cols-12">
          <h2 className="font-display text-4xl text-ink md:col-span-4">{c.title}</h2>
          <dl className="divide-y divide-line border-y border-line md:col-span-8">
            {c.items.map((it, i) => (
              <div key={i} className="grid gap-2 py-5 md:grid-cols-3">
                <dt className="text-[15px] font-medium text-ink">{it.title}</dt>
                <dd className="text-[15px] leading-relaxed text-muted md:col-span-2">{it.body}</dd>
              </div>
            ))}
          </dl>
        </Wrap>
      );
    }
    case "HOW_IT_WORKS": {
      const c = parseSection("HOW_IT_WORKS", s.content);
      return (
        <Wrap tone="paper-2">
          <h2 className="mb-12 font-display text-4xl text-ink">{c.title || ctx.labels.howItWorks}</h2>
          <ol className="grid gap-10 md:grid-cols-3">
            {c.steps.map((st, i) => (
              <li key={i}>
                <span className="font-display text-6xl leading-none text-ink/25">{i + 1}</span>
                <h3 className="mt-4 text-lg font-medium text-ink">{st.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{st.body}</p>
              </li>
            ))}
          </ol>
        </Wrap>
      );
    }
    case "DEMO": {
      const c = parseSection("DEMO", s.content);
      // Without real media the section is an internal to-do: hide it publicly, show it in preview.
      if (!c.videoUrl && !c.imageUrl && !ctx.preview) return null;
      return (
        <Wrap className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <h2 className="font-display text-4xl text-ink">{c.title}</h2>
            {c.body && <p className="mt-4 text-[15px] leading-relaxed text-muted">{c.body}</p>}
          </div>
          <figure>
            <Media videoUrl={c.videoUrl} imageUrl={c.imageUrl} ctx={ctx} />
            {c.caption && <figcaption className="mt-3 text-xs text-muted">{c.caption}</figcaption>}
          </figure>
        </Wrap>
      );
    }
    case "COMPARISON": {
      const c = parseSection("COMPARISON", s.content);
      return (
        <Wrap>
          <h2 className="mb-10 font-display text-4xl text-ink">{c.title}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-start text-[15px]">
              <thead>
                <tr className="border-b border-ink text-start">
                  <th className="py-3 text-start font-normal text-muted" />
                  <th className="py-3 text-start font-medium text-ink">{c.ourLabel}</th>
                  <th className="py-3 text-start font-normal text-muted">{c.altLabel}</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line">
                    <td className="py-4 text-muted">{r.label}</td>
                    <td className="py-4 text-ink">{r.ours}</td>
                    <td className="py-4 text-muted">{r.theirs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Wrap>
      );
    }
    case "SOCIAL_PROOF": {
      const c = parseSection("SOCIAL_PROOF", s.content);
      const useReviews = c.mode === "reviews" && ctx.reviews.length > 0;
      return (
        <Wrap tone="paper-2">
          <h2 className="mb-10 font-display text-4xl text-ink">{useReviews ? c.title : c.title || ctx.labels.whyInterested}</h2>
          {useReviews ? (
            <div className="grid gap-6 md:grid-cols-3">
              {ctx.reviews.slice(0, 6).map((r) => (
                <figure key={r.id} className="border-t border-ink pt-5">
                  <blockquote className="text-[15px] leading-relaxed text-ink-2">“{r.body}”</blockquote>
                  <figcaption className="mt-3 text-xs text-muted">
                    {r.authorDisplay ?? "Verified buyer"} · {r.rating ? `${r.rating}★ · ` : ""}
                    <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2">
                      {r.source}
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <ul className="grid gap-x-10 gap-y-5 md:grid-cols-2">
              {c.points.map((p) => (
                <li key={p} className="flex gap-4 border-t border-line pt-5 text-[17px] leading-relaxed text-ink-2">
                  <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink" />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </Wrap>
      );
    }
    case "FAQ": {
      const c = parseSection("FAQ", s.content);
      return (
        <Wrap className="grid gap-10 md:grid-cols-12">
          <h2 className="font-display text-4xl text-ink md:col-span-4">{c.title || ctx.labels.faq}</h2>
          <div className="md:col-span-8">
            {c.items.map((f, i) => (
              <details key={i} className="group border-b border-line py-5 first:border-t">
                <summary className="flex items-center justify-between gap-6 text-[17px] text-ink">
                  {f.q}
                  <span aria-hidden className="text-xl text-muted transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Wrap>
      );
    }
    case "CTA": {
      const c = parseSection("CTA", s.content);
      return (
        <Wrap tone="ink" className="text-center">
          <h2 className="mx-auto max-w-3xl text-balance font-display text-5xl leading-[1.02] md:text-6xl">{c.title}</h2>
          {c.body && <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-white/65">{c.body}</p>}
          <div className="mt-9 flex flex-col items-center gap-3">
            <Cta ctx={{ ...ctx, ctaLabel: c.ctaLabel || ctx.ctaLabel }} dark />
            {ctx.priceText && <span className="tabular text-sm text-white/70">{ctx.priceText}</span>}
            {c.note && <p className="text-xs text-white/45">{c.note}</p>}
          </div>
        </Wrap>
      );
    }
    case "SHIPPING":
    case "RETURNS": {
      const c = parseSection(s.type, s.content);
      return (
        <section className="mx-auto max-w-[1200px] px-5 md:px-10">
          <div className="grid gap-4 border-t border-line py-8 md:grid-cols-12">
            <h2 className="eyebrow text-muted md:col-span-4">{c.title || (s.type === "SHIPPING" ? ctx.labels.shipping : ctx.labels.returns)}</h2>
            <p className="text-[15px] leading-relaxed text-ink-2 md:col-span-8">{c.body}</p>
          </div>
        </section>
      );
    }
    case "DISCLOSURE": {
      const c = parseSection("DISCLOSURE", s.content);
      if (!c.body) return null;
      return (
        <section className="mx-auto max-w-[1200px] px-5 py-8 md:px-10">
          <p className="rounded-[2px] border border-line p-5 text-xs leading-relaxed text-muted">
            <span className="eyebrow me-2 text-ink">{ctx.labels.disclosure}</span>
            {c.body}
          </p>
        </section>
      );
    }
    default:
      return null;
  }
}

export function LandingRenderer({ sections, ctx }: { sections: RenderSection[]; ctx: RenderContext }) {
  return (
    <>
      {sections
        .filter((s) => s.enabled)
        .map((s) => (
          <SectionView key={s.id} s={s} ctx={ctx} />
        ))}
    </>
  );
}
