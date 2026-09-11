// Landing page section contracts (client-safe): validated by the builder and the renderer.

import { z } from "zod";
import type { LandingTemplate, SectionType } from "./constants";

const str = (max = 400) => z.string().max(max).default("");
const TitleBody = z.object({ title: str(120), body: str(600) });

export const SECTION_SCHEMAS = {
  HERO: z.object({
    eyebrow: str(60),
    headline: str(140),
    subheadline: str(300),
    ctaLabel: str(40),
    secondaryLabel: str(40),
    imageUrl: str(2048),
    videoUrl: str(2048),
    badges: z.array(z.string().max(40)).max(4).default([]),
  }),
  PROBLEM: z.object({ title: str(140), body: str(800), points: z.array(z.string().max(200)).max(6).default([]) }),
  SOLUTION: z.object({ title: str(140), body: str(800) }),
  BENEFITS: z.object({ title: str(140), items: z.array(TitleBody).max(6).default([]) }),
  FEATURES: z.object({ title: str(140), items: z.array(TitleBody).max(8).default([]) }),
  HOW_IT_WORKS: z.object({ title: str(140), steps: z.array(TitleBody).max(5).default([]) }),
  DEMO: z.object({ title: str(140), body: str(500), videoUrl: str(2048), imageUrl: str(2048), caption: str(200) }),
  COMPARISON: z.object({
    title: str(140),
    ourLabel: str(60),
    altLabel: str(60),
    rows: z.array(z.object({ label: str(80), ours: str(120), theirs: str(120) })).max(8).default([]),
  }),
  SOCIAL_PROOF: z.object({
    title: str(140),
    // "interest" = "Why customers are interested" (never testimonials). "reviews" = imported, attributed real reviews only.
    mode: z.enum(["interest", "reviews"]).default("interest"),
    points: z.array(z.string().max(200)).max(6).default([]),
  }),
  FAQ: z.object({ title: str(140), items: z.array(z.object({ q: str(200), a: str(800) })).max(10).default([]) }),
  CTA: z.object({ title: str(140), body: str(400), ctaLabel: str(40), note: str(200) }),
  TRUST: z.object({ title: str(140), items: z.array(TitleBody).max(6).default([]) }),
  SHIPPING: z.object({ title: str(140), body: str(800) }),
  RETURNS: z.object({ title: str(140), body: str(800) }),
  DISCLOSURE: z.object({ body: str(1000) }),
} satisfies Record<SectionType, z.ZodType>;

export type SectionContentMap = { [K in SectionType]: z.infer<(typeof SECTION_SCHEMAS)[K]> };

export function parseSection<K extends SectionType>(type: K, content: unknown): SectionContentMap[K] {
  const parsed = SECTION_SCHEMAS[type].safeParse(content ?? {});
  return (parsed.success ? parsed.data : SECTION_SCHEMAS[type].parse({})) as SectionContentMap[K];
}

export const SECTION_LABELS: Record<SectionType, string> = {
  HERO: "Hero",
  PROBLEM: "Problem",
  SOLUTION: "Solution",
  BENEFITS: "Benefits",
  FEATURES: "Features",
  HOW_IT_WORKS: "How it works",
  DEMO: "Product demo",
  COMPARISON: "Comparison",
  SOCIAL_PROOF: "Why people are interested",
  FAQ: "FAQ",
  CTA: "Call to action",
  TRUST: "Trust",
  SHIPPING: "Shipping",
  RETURNS: "Returns",
  DISCLOSURE: "Disclosure",
};

/** Template A–E section orders. */
export const TEMPLATE_LAYOUTS: Record<LandingTemplate, { label: string; description: string; sections: SectionType[] }> = {
  PROBLEM_SOLUTION: {
    label: "A · Problem → Solution",
    description: "Lead with the pain, prove the fix, remove doubts.",
    sections: ["HERO", "PROBLEM", "SOLUTION", "HOW_IT_WORKS", "BENEFITS", "FEATURES", "SOCIAL_PROOF", "FAQ", "TRUST", "SHIPPING", "RETURNS", "CTA", "DISCLOSURE"],
  },
  VIRAL: {
    label: "B · Viral product",
    description: "Demo-first page for social traffic that already saw the video.",
    sections: ["HERO", "DEMO", "BENEFITS", "SOCIAL_PROOF", "FAQ", "SHIPPING", "CTA", "DISCLOSURE"],
  },
  PREMIUM: {
    label: "C · Premium product",
    description: "Editorial, feature-led, with a considered comparison.",
    sections: ["HERO", "FEATURES", "HOW_IT_WORKS", "COMPARISON", "TRUST", "FAQ", "RETURNS", "CTA", "DISCLOSURE"],
  },
  IMPULSE: {
    label: "D · Impulse buy",
    description: "Short and fast: benefit, price, go.",
    sections: ["HERO", "BENEFITS", "CTA", "FAQ", "SHIPPING", "DISCLOSURE"],
  },
  UGC: {
    label: "E · UGC-style",
    description: "Creator-video led, conversational, proof through demonstration.",
    sections: ["HERO", "DEMO", "PROBLEM", "SOLUTION", "SOCIAL_PROOF", "FAQ", "CTA", "DISCLOSURE"],
  },
};
