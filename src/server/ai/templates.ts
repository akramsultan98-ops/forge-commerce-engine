// FORGE template engine — deterministic, rule-based copy generation used when AI is unavailable
// (DEMO_MODE, no API key, budget reached, or provider failure). Output is labelled TEMPLATE in the
// UI. It only restates facts from the ProductBrief and never invents reviews, numbers or claims.

import type { ContentAngle, ContentType, LandingTemplate, Platform } from "@/lib/constants";
import { CONTENT_ANGLES } from "@/lib/constants";
import { pickStable, round, shuffleStable, truncate } from "@/lib/utils";
import { metaDescription, seoTitle } from "@/domain/seo";
import { formatMoney, suggestPrice } from "@/domain/money";
import type { ProductBrief } from "./brief";
import type { ArticleOutput, ContentConcept, CopyOutput, ResearchOutput } from "./schemas";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const low = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const strip = (s: string) => s.replace(/[.!?]+$/, "");
const price = (b: ProductBrief) => (b.price !== null ? formatMoney(b.price, b.currency) : null);
const noun = (b: ProductBrief) => `the ${b.shortName.toLowerCase()}`;
const firstSentence = (s: string) => (s.match(/^[^.!?]+[.!?]/)?.[0] ?? s).trim();

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const PROV_LABEL: Record<string, string> = {
  REAL: "live data",
  ESTIMATED: "estimate",
  AI_INFERENCE: "AI inference",
  MANUAL: "operator input",
  DEMO: "demo data",
  MISSING: "no data",
};

function factorLine(b: ProductBrief, key: string, missing: string): string {
  const f = b.factors[key];
  if (!f || f.provenance === "MISSING") return missing;
  return `${f.note} (${PROV_LABEL[f.provenance] ?? f.provenance}).`;
}

// ── Research ────────────────────────────────────────────────────────────────
export function templateResearch(b: ProductBrief): ResearchOutput {
  const score = b.score ?? 50;
  const verdict: ResearchOutput["verdict"] = b.riskLevel === "HIGH" ? "DO_NOT_TEST" : score >= 70 ? "TEST" : score >= 55 ? "WATCH" : "DO_NOT_TEST";
  const strengths = b.reasons.slice(0, 3).map(low);
  const concerns = b.warnings.filter((w) => !w.startsWith("Missing data") && !w.startsWith("Scored on demo")).slice(0, 3).map(low);
  const p = price(b);

  const thesis = `TEST THIS PRODUCT BECAUSE ${strengths.length ? joinList(strengths) : "its fundamentals are balanced"}. It fixes ${strip(b.problem)} for ${b.audience}, and the before/after reads clearly in a single short clip.`;
  const antiThesis = `DO NOT TEST THIS PRODUCT BECAUSE ${
    concerns.length ? joinList(concerns) : b.confidence !== null && b.confidence < 0.5 ? "the score rests on thin or estimated data — the upside is unproven" : "the case is only as strong as the unverified inputs behind it"
  }${b.riskFlags.length ? `; compliance flags: ${joinList(b.riskFlags.map(low))}` : ""}.`;

  const suggested = b.businessModel !== "AFFILIATE" && b.cost !== null ? suggestPrice(b.cost, b.shippingCost ?? 0) : null;
  const angles = [
    `Problem → fix: open on ${strip(b.problem)}, then show ${noun(b)} solving it in one continuous take.`,
    `Before/after: the same moment with and without ${noun(b)}, side by side.`,
    p ? `Price reality: what people usually spend or put up with vs. ${p}.` : `Simplicity: one small change that removes a daily annoyance.`,
    `Gift angle: a practical, useful gift for ${b.audience}.`,
    `Myth-busting: you don't need an expensive setup to fix ${strip(b.problem)}.`,
  ];
  const hooks = [
    "I didn't know this existed until last week.",
    `If ${strip(b.problem)} drives you mad, watch this.`,
    p && b.price !== null && b.price <= 30 ? `This costs about ${p} and fixed ${strip(b.problem)}.` : `The simple fix for ${strip(b.problem)}.`,
    `POV: ${strip(b.problem)} stops being your problem.`,
    `Nobody talks about this ${b.category.toLowerCase()} upgrade.`,
  ];
  const ctas = b.businessModel === "AFFILIATE" ? ["Check today's price", "See how it works", "Get it from the official store"] : ["Get yours", "See how it works", "Order now — ships from our supplier"];

  const risks = [
    ...concerns.map(cap),
    ...b.riskFlags,
    b.businessModel === "AFFILIATE" ? "Commission rates and cookie windows can change — re-check the program monthly." : "Supplier quality varies — order a sample before sending paid traffic.",
  ];

  return {
    verdict,
    thesis,
    antiThesis,
    whyTrending: factorLine(b, "trend", "No live trend data is connected for this product yet. Connect a trend source (Sources → Wikipedia trends or a marketplace API) before treating it as trending."),
    demand: factorLine(b, "velocity", "No sales-velocity data yet — demand is unverified."),
    competition: factorLine(b, "competition", "No competition data yet — check marketplace seller counts and active ads before testing."),
    supplierNotes:
      b.businessModel === "AFFILIATE"
        ? "Merchant-fulfilled via affiliate link — FORGE never holds inventory. Confirm the program allows social traffic."
        : `Supplier cost ${b.cost !== null ? formatMoney(b.cost, b.currency) : "unknown"}. Confirm packaging, variant quality and a sample order before scaling.`,
    shippingNotes:
      b.shippingDaysMax !== null
        ? `Supplier estimate: ${b.shippingDaysMin ?? b.shippingDaysMax}–${b.shippingDaysMax} days. ${b.shippingDaysMax > 12 ? "Long enough to state clearly on the page to avoid refund requests." : "Fast enough to not be a conversion blocker."}`
        : b.businessModel === "AFFILIATE"
          ? "Shipping is handled by the merchant and shown at their checkout."
          : "Shipping time unknown — get it from the supplier before publishing.",
    socialPotential: factorLine(b, "content", "Content potential not assessed yet — film one test clip before committing to a batch."),
    contentOpportunity: "Problem/solution and before/after are the natural formats; POV and unexpected-use make good variations once a hook wins.",
    targetCustomer: cap(b.audience),
    marketingAngles: angles,
    hooks,
    ctas,
    landingAngle: `Lead with the problem (${strip(b.problem)}), prove the fix with a short demo above the fold, then answer shipping and returns plainly.`,
    risks,
    riskLevel: b.riskLevel ?? "LOW",
    recommendedAction:
      verdict === "TEST"
        ? "Launch a 14-day test: publish the landing page, ship 10 short-form videos across TikTok, Reels and Shorts, and track affiliate CTR and conversion."
        : verdict === "WATCH"
          ? "Keep on the watchlist. Gather real trend or sales data before spending time on content."
          : "Skip for now. Revisit only if the flagged risks or weak signals change.",
    suggestedPrice: suggested,
    factorEstimates: null,
  };
}

// ── Product copy ────────────────────────────────────────────────────────────
function splitHighlight(h: string): { title: string; body: string } {
  const [head, ...rest] = h.split(/:\s+|\s[–—]\s/);
  if (rest.length) return { title: cap(head.trim()), body: cap(rest.join(" — ").trim()) };
  const words = h.split(/\s+/);
  return { title: cap(words.slice(0, 4).join(" ").replace(/[,.]$/, "")), body: cap(h) };
}

export function templateCopy(b: ProductBrief, disclosure: { returns: string; shipping: string }): CopyOutput {
  const p = price(b);
  const affiliate = b.businessModel === "AFFILIATE";
  const features = b.highlights.slice(0, 6).map(splitHighlight);
  const headline = `The simple fix for ${strip(b.problem)}.`;
  const sub = b.description ? firstSentence(b.description) : `${b.shortName} — built for ${b.audience} who are done with ${strip(b.problem)}.`;

  const benefits = [
    { title: "Less friction, every day", body: `One less moment lost to ${strip(b.problem)}.` },
    { title: "Simple by design", body: features[0] ? features[0].body : "It does one job and does it well — nothing to configure." },
    { title: "An easy upgrade", body: `A practical pick for ${b.audience}${p ? `, at ${p}` : ""}.` },
  ];

  const interest = [
    `It solves a specific, everyday annoyance: ${strip(b.problem)}.`,
    ...(b.reasons.some((r) => /demonstration/i.test(r)) ? ["The result is visible in seconds, which is why it shows up well in short videos."] : []),
    ...(p ? [`Accessible price point (${p}).`] : []),
    ...(b.rating ? [`Rated ${b.rating.value}★ across ${b.rating.count.toLocaleString()} reviews on ${b.rating.source}.`] : []),
    `Made for ${b.audience}.`,
  ].slice(0, 4);

  const faqs = [
    { q: "Who is it for?", a: `${cap(b.audience)} — anyone dealing with ${strip(b.problem)}.` },
    {
      q: "How long does shipping take?",
      a: b.shippingDaysMax !== null ? `Typical delivery is ${b.shippingDaysMin ?? b.shippingDaysMax}–${b.shippingDaysMax} days (supplier estimate). The exact date is shown at checkout.` : disclosure.shipping,
    },
    { q: "What if it doesn't work for me?", a: disclosure.returns },
    {
      q: "Where do I buy it?",
      a: affiliate
        ? "You check out on the merchant's site. FORGE may earn a commission when you buy through our link — the price is the same for you."
        : "Right here. Checkout is secure and your order ships from our fulfilment partner.",
    },
    { q: "Is the price shown final?", a: "Prices can change. The checkout page shows the final price, including any shipping and tax." },
  ];

  return {
    seoTitle: seoTitle(`${b.shortName}: the simple fix for ${strip(b.problem)}`),
    metaDescription: metaDescription(`${b.shortName} fixes ${strip(b.problem)}. ${sub} ${affiliate ? "See today's price." : "Shipping and returns explained."}`),
    headline,
    subheadline: sub,
    description: [sub, features.length ? `Key details: ${features.map((f) => low(f.body.replace(/\.$/, ""))).slice(0, 3).join("; ")}.` : "", `Made for ${b.audience}.`].filter(Boolean).join(" "),
    problemStatement: `${cap(strip(b.problem))} sounds small until it happens every day. Most fixes are fiddly, ugly or overpriced.`,
    solution: `${b.shortName} is a small, focused fix for exactly this.${features.length ? ` ${features.slice(0, 2).map((f) => f.body.replace(/\.$/, "")).join(". ")}.` : ""}`,
    benefits,
    features: features.length ? features : [{ title: "Focused design", body: "Built for one job, without extras you won't use." }],
    howItWorks: [
      { title: affiliate ? "Check the price" : "Order", body: affiliate ? "Tap through to the merchant — shipping and returns are handled by them." : "Order here — we pass it straight to our fulfilment partner." },
      { title: "Set it up", body: features[1]?.body ?? "It's ready to use out of the box." },
      { title: "Forget about the problem", body: `${cap(strip(b.problem))} stops being part of your day.` },
    ],
    faqs,
    interestPoints: interest,
    trustPoints: [
      { title: "Picked on signals, not sponsorship", body: "Products are ranked by FORGE's scoring engine. No paid placements." },
      { title: "No fake reviews, ever", body: "When we show reviews they're imported from a named source, with a link." },
      { title: "Clear about money", body: affiliate ? "Affiliate links are labelled. You never pay more because of them." : "The price you see is the price you pay at checkout, before shipping and tax." },
    ],
    ctaLabel: affiliate ? "Check price" : "Get yours",
    ctaNote: affiliate ? "You'll continue to the merchant's website." : "Secure checkout.",
    hooks: templateResearch(b).hooks,
    ctas: affiliate ? ["Check today's price", "See it in action", "Get it from the official store"] : ["Get yours", "See it in action", "Order today"],
    emailSubject: `The simple fix for ${strip(b.problem)}`,
    emailBody: `Hi —\n\nQuick one. If ${strip(b.problem)} is part of your week, ${b.shortName} is worth a look.\n\n${sub}\n\n${affiliate ? "Check today's price" : "Get yours"}: {{link}}\n\n${affiliate ? "(Affiliate link — we may earn a commission at no cost to you.)\n\n" : ""}— FORGE`,
  };
}

// ── Landing page sections ───────────────────────────────────────────────────
export function templateLandingSections(
  b: ProductBrief,
  copy: CopyOutput,
  layout: { sections: string[] },
  opts: { disclosure: string; returns: string; shipping: string; template: LandingTemplate },
): Array<{ type: string; content: Record<string, unknown> }> {
  const p = price(b);
  const affiliate = b.businessModel === "AFFILIATE";
  const heroHeadline: Record<LandingTemplate, string> = {
    PROBLEM_SOLUTION: copy.headline,
    VIRAL: `Seen it in a video? Here's how it actually works.`,
    PREMIUM: `${b.shortName}, done properly.`,
    IMPULSE: `${b.shortName}${p ? ` — ${p}` : ""}.`,
    UGC: `What changed after two weeks with ${noun(b)}.`,
  };
  const content: Record<string, Record<string, unknown>> = {
    HERO: {
      eyebrow: b.category,
      headline: heroHeadline[opts.template],
      subheadline: copy.subheadline,
      ctaLabel: copy.ctaLabel,
      secondaryLabel: "How it works",
      imageUrl: "",
      videoUrl: "",
      badges: [b.shippingDaysMax !== null ? `Ships in ~${b.shippingDaysMax} days` : "", affiliate ? "Buy from the official merchant" : "Secure checkout"].filter(Boolean),
    },
    PROBLEM: { title: "The problem", body: copy.problemStatement, points: [`${cap(strip(b.problem))}.`, "Workarounds that don't really work.", "Time and patience lost, a little every day."] },
    SOLUTION: { title: "The fix", body: copy.solution },
    BENEFITS: { title: "Why it's worth it", items: copy.benefits },
    FEATURES: { title: "The details", items: copy.features },
    HOW_IT_WORKS: { title: "How it works", steps: copy.howItWorks },
    DEMO: { title: "See it in action", body: "Add a short, uncut clip of the product solving the problem — one take is more believable than ten cuts.", videoUrl: "", imageUrl: "", caption: "Demo video pending" },
    COMPARISON: {
      title: "Compared with the usual workaround",
      ourLabel: b.shortName,
      altLabel: "Typical workaround",
      rows: [
        { label: "Effort", ours: "Set up once", theirs: "Repeated every time" },
        { label: "Result", ours: "Consistent", theirs: "Hit and miss" },
        { label: "Cost", ours: p ?? "See price", theirs: "Time, or a pricier setup" },
      ],
    },
    SOCIAL_PROOF: { title: "Why people are interested", mode: "interest", points: copy.interestPoints },
    FAQ: { title: "Questions", items: copy.faqs },
    CTA: { title: `Ready to fix ${strip(b.problem)}?`, body: copy.subheadline, ctaLabel: copy.ctaLabel, note: copy.ctaNote },
    TRUST: { title: "How FORGE works", items: copy.trustPoints },
    SHIPPING: { title: "Shipping", body: copy.faqs[1]?.a ?? opts.shipping },
    RETURNS: { title: "Returns", body: opts.returns },
    DISCLOSURE: { body: affiliate ? opts.disclosure : "FORGE lists this product for sale through a fulfilment partner. Prices and availability can change." },
  };
  return layout.sections.map((type) => ({ type, content: content[type] ?? {} }));
}

// ── Short-form & social concepts ────────────────────────────────────────────
type AngleTpl = { title: (b: ProductBrief) => string; hook: (b: ProductBrief) => string; problem: (b: ProductBrief) => string; demo: (b: ProductBrief) => string; payoff: (b: ProductBrief) => string };

const ANGLES: Record<ContentAngle, AngleTpl> = {
  CURIOSITY: {
    title: (b) => `Didn't know it existed — ${b.shortName}`,
    hook: () => "I didn't know this existed until last week…",
    problem: (b) => `Most people just live with ${strip(b.problem)}.`,
    demo: (b) => `Show ${noun(b)} doing its one job, close-up, in a single take.`,
    payoff: () => "Cut to the finished result. Hold for a beat — let it land.",
  },
  PROBLEM_SOLUTION: {
    title: (b) => `Problem → fix: ${strip(b.problem)}`,
    hook: (b) => `If ${strip(b.problem)} drives you mad, watch this.`,
    problem: (b) => `Show the problem as it really happens: ${strip(b.problem)}.`,
    demo: (b) => `Same scene, now with ${noun(b)}. No cuts during the fix.`,
    payoff: () => "Split-screen: before on the left, after on the right.",
  },
  BEFORE_AFTER: {
    title: (b) => `Before / after with ${b.shortName}`,
    hook: () => "Same spot. Ten seconds apart.",
    problem: () => "Start on the 'before' — messy, awkward, frustrating.",
    demo: (b) => `Wipe transition into the 'after', with ${noun(b)} in frame.`,
    payoff: () => "Flip between before and after twice. No voiceover needed.",
  },
  POV: {
    title: (b) => `POV: ${strip(b.problem)} is finally solved`,
    hook: (b) => `POV: ${strip(b.problem)} stops being your problem.`,
    problem: () => "First-person shot of the old routine going wrong.",
    demo: (b) => `Hands reach for ${noun(b)}. Show it working from the same POV.`,
    payoff: () => "Relieved reaction, then back to normal life.",
  },
  UNEXPECTED_USE: {
    title: (b) => `An unexpected way to use ${b.shortName}`,
    hook: () => "Nobody uses it for this — they should.",
    problem: (b) => `Everyone buys it for ${strip(b.problem)}…`,
    demo: (b) => `…but show a second, genuinely useful way ${noun(b)} helps.`,
    payoff: () => "Ask viewers what else they'd use it for.",
  },
  COMPARISON: {
    title: (b) => `The usual workaround vs ${b.shortName}`,
    hook: () => "The way most people do it vs. the way I do it now.",
    problem: () => "Show the common workaround and why it's annoying.",
    demo: (b) => `Same task with ${noun(b)}. Keep both clips the same length.`,
    payoff: () => "On-screen text: which one would you pick?",
  },
  EXPERIMENT: {
    title: (b) => `I used ${b.shortName} for 7 days`,
    hook: () => "I used this every day for a week. Here's what happened.",
    problem: (b) => `Day 1: the problem — ${strip(b.problem)}.`,
    demo: () => "Quick daily clips, day 2 to day 7, same framing each day.",
    payoff: () => "Honest verdict: what worked, what didn't.",
  },
  CHALLENGE: {
    title: (b) => `Can ${b.shortName} handle this?`,
    hook: () => "Let's see if this actually holds up.",
    problem: () => "Set up a realistic, slightly tough test.",
    demo: (b) => `Run the test with ${noun(b)}. No edits in the key moment.`,
    payoff: () => "Show the outcome — pass or fail, keep it honest.",
  },
  REACTION: {
    title: (b) => `Showing ${b.shortName} to someone for the first time`,
    hook: () => "I showed this to someone who's never seen it.",
    problem: (b) => `They explain how they deal with ${strip(b.problem)} today.`,
    demo: (b) => `Hand them ${noun(b)} — capture the first try, unscripted.`,
    payoff: () => "Their genuine reaction. Only use real, consented footage.",
  },
  EDUCATIONAL: {
    title: (b) => `3 things nobody tells you about ${strip(b.problem)}`,
    hook: (b) => `3 things nobody tells you about ${strip(b.problem)}.`,
    problem: () => "Tip 1 and tip 2: free fixes anyone can do.",
    demo: (b) => `Tip 3: the tool that makes it effortless — ${noun(b)}.`,
    payoff: () => "Recap all three on screen.",
  },
  UGC: {
    title: (b) => `Honest take after two weeks with ${b.shortName}`,
    hook: () => "Honest review after two weeks — no sponsorship.",
    problem: (b) => `Why I bought it: ${strip(b.problem)}.`,
    demo: () => "Handheld, natural light, real environment. Show daily use.",
    payoff: () => "One thing you love, one thing you'd change.",
  },
  UNBOXING: {
    title: (b) => `Unboxing ${b.shortName} — first impressions`,
    hook: () => "Unboxing it — first impressions, no edits.",
    problem: () => "What's in the box, laid out flat.",
    demo: () => "First use, straight out of the packaging.",
    payoff: () => "Would you keep it? Quick yes/no on screen.",
  },
  REVIEW: {
    title: (b) => `Is ${b.shortName} worth it?`,
    hook: (b) => (b.price !== null ? `Is this worth ${formatMoney(b.price, b.currency)}? Honest take.` : "Is this actually worth it? Honest take."),
    problem: (b) => `What it promises: a fix for ${strip(b.problem)}.`,
    demo: () => "Test the main promise on camera.",
    payoff: () => "Verdict with one pro and one con.",
  },
  MYTH_BUSTING: {
    title: (b) => `Myth: you need an expensive setup to fix ${strip(b.problem)}`,
    hook: () => "Myth: you need something expensive to fix this.",
    problem: () => "Show the pricey or complicated option people assume they need.",
    demo: (b) => `Now the simple option: ${noun(b)}, doing the same job.`,
    payoff: () => "Bust the myth with the side-by-side result.",
  },
};

const PLATFORM_CTA: Record<string, string> = {
  TIKTOK: "Link in bio to check the price.",
  INSTAGRAM: "Link in bio for details.",
  YOUTUBE: "Link in the description.",
  PINTEREST: "Tap through for details.",
  FACEBOOK: "Details at the link.",
  X: "Details at the link.",
};

function hashtagsFor(b: ProductBrief, platform: Platform): string[] {
  const clean = (s: string) => `#${s.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const base = [clean(b.shortName), clean(b.category), ...b.tags.slice(0, 3).map(clean)];
  const extra = platform === "PINTEREST" ? [] : ["#problemsolved", "#usefulfinds"];
  return Array.from(new Set([...base, ...extra])).filter((h) => h.length > 2).slice(0, platform === "X" ? 2 : 6);
}

export function templateConcepts(b: ProductBrief, opts: { platform: Platform; contentType: ContentType; count: number; offset?: number; angles?: ContentAngle[] }): ContentConcept[] {
  const affiliate = b.businessModel === "AFFILIATE";
  const order = opts.angles?.length ? opts.angles : shuffleStable(CONTENT_ANGLES, `${b.id}:${opts.platform}:${opts.contentType}`);
  const cta = PLATFORM_CTA[opts.platform] ?? "See details at the link.";
  const disclosure = affiliate ? " (affiliate link)" : "";
  const out: ContentConcept[] = [];
  for (let i = 0; i < opts.count; i++) {
    const angle = order[(i + (opts.offset ?? 0)) % order.length];
    const t = ANGLES[angle];
    const hook = t.hook(b);
    const isVideo = ["TIKTOK_VIDEO", "INSTAGRAM_REEL", "YOUTUBE_SHORT", "AD_CONCEPT"].includes(opts.contentType);
    const beats: ContentConcept["beats"] = isVideo
      ? [
          { label: "HOOK", from: 0, to: 3, line: hook, visual: "Tight shot, movement in frame from the first frame. Text overlay repeats the hook." },
          { label: "PROBLEM", from: 3, to: 7, line: t.problem(b), visual: "Show the real problem in a real setting." },
          { label: "DEMONSTRATION", from: 7, to: 15, line: t.demo(b), visual: "One continuous take for the key moment — it's more believable." },
          { label: "PAYOFF", from: 15, to: 22, line: t.payoff(b), visual: "Hold on the result for at least a second." },
          { label: "CTA", from: 22, to: 26, line: cta, visual: "Product in frame, simple end card." },
        ]
      : [];
    let body = "";
    if (opts.contentType === "CAROUSEL") {
      body = [`Slide 1 — ${hook}`, `Slide 2 — The problem: ${strip(b.problem)}.`, `Slide 3 — The fix: ${b.shortName}.`, `Slide 4 — How it works: ${b.highlights[0] ?? "simple, one-job design"}.`, `Slide 5 — ${cta}${disclosure}`].join("\n");
    } else if (opts.contentType === "PINTEREST_PIN") {
      body = truncate(`${b.shortName}: the simple fix for ${strip(b.problem)}. ${b.highlights[0] ? `${b.highlights[0]}.` : ""} ${cta}${disclosure}`, 480);
    } else if (opts.contentType === "EDUCATIONAL_POST") {
      body = `3 ways to deal with ${strip(b.problem)}:\n1. The free workaround most people try first.\n2. A habit change that helps a little.\n3. The tool that makes it effortless — ${b.shortName}.`;
    } else if (opts.contentType === "PROBLEM_SOLUTION_POST") {
      body = `Problem: ${cap(strip(b.problem))}.\nFix: ${b.shortName}.\nWhy it works: ${b.highlights[0] ?? "it's built for exactly this job"}.`;
    } else if (opts.contentType === "STATIC_POST") {
      body = `${hook}\n\n${b.shortName} — ${b.highlights[0] ?? `made for ${b.audience}`}.`;
    }
    out.push({
      angle,
      title: t.title(b),
      hook,
      beats,
      body,
      caption: truncate(`${hook} ${b.shortName} fixes ${strip(b.problem)}. ${cta}${disclosure}`, opts.platform === "X" ? 260 : 600),
      cta: `${cta}${disclosure}`,
      hashtags: hashtagsFor(b, opts.platform),
    });
  }
  return out;
}

export function templateImagePrompt(b: ProductBrief, style: "studio" | "lifestyle" | "flatlay" = "studio"): string {
  const scene = {
    studio: "on warm off-white seamless paper, soft directional light from the left, subtle shadow",
    lifestyle: `in use in a real, tidy everyday setting relevant to ${b.audience}`,
    flatlay: "top-down flat lay on a neutral linen surface with minimal props",
  }[style];
  return `Editorial product photograph of ${b.shortName.toLowerCase()} ${scene}. 50mm lens, shallow depth of field, natural colour, premium catalogue style. No text, no logos, no people's faces.`;
}

// ── Editorial / discovery articles ──────────────────────────────────────────
export function templateArticle(kind: "LISTICLE" | "BEST_FOR" | "VERSUS" | "ALTERNATIVES" | "GUIDE", briefs: ProductBrief[], topic: string): ArticleOutput {
  const items = briefs.slice(0, 7);
  const title =
    kind === "LISTICLE"
      ? `${items.length} products that solve small ${topic.toLowerCase()} annoyances`
      : kind === "BEST_FOR"
        ? `Best ${topic.toLowerCase()} upgrades under $50`
        : kind === "VERSUS" && items.length >= 2
          ? `${items[0].shortName} vs ${items[1].shortName}: which one is worth it?`
          : kind === "ALTERNATIVES" && items[0]
            ? `Best alternatives to ${items[0].shortName}`
            : `Things you didn't know you needed: ${topic}`;
  const blocks: ArticleOutput["blocks"] = [
    { kind: "p", text: `We look for products that fix one specific problem well, are easy to understand in a few seconds, and don't rely on hype. Here's what made the cut for ${topic.toLowerCase()} — including the watch-outs.` },
  ];
  for (const b of items) {
    blocks.push({ kind: "h2", text: b.shortName });
    blocks.push({ kind: "p", text: `Best for ${b.audience}. It targets ${strip(b.problem)}.${b.highlights[0] ? ` ${b.highlights[0]}.` : ""}` });
    const pros = b.reasons.slice(0, 2);
    const cons = b.warnings.filter((w) => !w.startsWith("Missing data") && !w.startsWith("Scored on demo") && !w.startsWith("Risk:")).slice(0, 2);
    if (pros.length || cons.length) blocks.push({ kind: "list", items: [...pros.map((p) => `+ ${p}`), ...cons.map((c) => `– ${c}`)] });
    blocks.push({ kind: "product", productId: b.id });
  }
  blocks.push({ kind: "p", text: "Prices and availability change. Some links are affiliate links; they never change what we recommend or what you pay." });
  return {
    title,
    excerpt: truncate(`Honest picks for ${topic.toLowerCase()}: what each product fixes, who it's for, and what to watch out for.`, 200),
    seoTitle: seoTitle(title),
    metaDescription: metaDescription(`Honest, signal-based picks for ${topic.toLowerCase()} — what each product fixes, who it's for and the watch-outs.`),
    blocks,
  };
}

export function scoreWord(score: number | null): string {
  if (score === null) return "unscored";
  return score >= 80 ? "strong" : score >= 65 ? "promising" : score >= 50 ? "average" : "weak";
}

export { pickStable, round };
