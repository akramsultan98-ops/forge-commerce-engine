// Structured-output contracts shared by AI providers and the deterministic template engine.
// Both paths must produce exactly these shapes, so downstream code never cares which one ran.

import { z } from "zod";
import { CONTENT_ANGLES, RISK_LEVELS } from "@/lib/constants";

export const ResearchSchema = z.object({
  verdict: z.enum(["TEST", "WATCH", "DO_NOT_TEST"]),
  thesis: z.string().describe('Bull case, starting with "TEST THIS PRODUCT BECAUSE"'),
  antiThesis: z.string().describe('Bear case, starting with "DO NOT TEST THIS PRODUCT BECAUSE"'),
  whyTrending: z.string().describe("Only claims supported by the provided signals; say so when data is missing"),
  demand: z.string(),
  competition: z.string(),
  supplierNotes: z.string(),
  shippingNotes: z.string(),
  socialPotential: z.string(),
  contentOpportunity: z.string(),
  targetCustomer: z.string(),
  marketingAngles: z.array(z.string()),
  hooks: z.array(z.string()),
  ctas: z.array(z.string()),
  landingAngle: z.string(),
  risks: z.array(z.string()),
  riskLevel: z.enum(RISK_LEVELS),
  recommendedAction: z.string(),
  suggestedPrice: z.number().nullable(),
  factorEstimates: z
    .object({
      contentScore: z.number().describe("0-100 visual demonstration potential"),
      problemScore: z.number().describe("0-100 problem/solution strength"),
      impulseScore: z.number().describe("0-100 impulse-buy appeal"),
      noveltyScore: z.number().describe("0-100 novelty"),
    })
    .nullable()
    .describe("Qualitative judgement only; null if you cannot judge"),
});
export type ResearchOutput = z.infer<typeof ResearchSchema>;

const TitleBody = z.object({ title: z.string(), body: z.string() });

export const CopySchema = z.object({
  seoTitle: z.string(),
  metaDescription: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  description: z.string(),
  problemStatement: z.string(),
  solution: z.string(),
  benefits: z.array(TitleBody),
  features: z.array(TitleBody),
  howItWorks: z.array(TitleBody),
  faqs: z.array(z.object({ q: z.string(), a: z.string() })),
  interestPoints: z.array(z.string()).describe('"Why customers are interested" — never testimonials'),
  trustPoints: z.array(TitleBody),
  ctaLabel: z.string(),
  ctaNote: z.string(),
  hooks: z.array(z.string()),
  ctas: z.array(z.string()),
  emailSubject: z.string(),
  emailBody: z.string(),
});
export type CopyOutput = z.infer<typeof CopySchema>;

export const BeatSchema = z.object({
  label: z.enum(["HOOK", "PROBLEM", "DEMONSTRATION", "PAYOFF", "CTA"]),
  from: z.number(),
  to: z.number(),
  line: z.string(),
  visual: z.string(),
});

export const ConceptSchema = z.object({
  angle: z.enum(CONTENT_ANGLES),
  title: z.string(),
  hook: z.string(),
  beats: z.array(BeatSchema),
  body: z.string().describe("Post text / carousel slides / pin description; empty for pure video"),
  caption: z.string(),
  cta: z.string(),
  hashtags: z.array(z.string()),
});
export type ContentConcept = z.infer<typeof ConceptSchema>;

export const ConceptBatchSchema = z.object({ concepts: z.array(ConceptSchema) });

export const ArticleSchema = z.object({
  title: z.string(),
  excerpt: z.string(),
  seoTitle: z.string(),
  metaDescription: z.string(),
  blocks: z.array(
    z.object({
      kind: z.enum(["p", "h2", "product", "list"]),
      text: z.string().optional(),
      productId: z.string().optional(),
      items: z.array(z.string()).optional(),
    }),
  ),
});
export type ArticleOutput = z.infer<typeof ArticleSchema>;

export const COMMAND_INTENTS = [
  "FIND_PRODUCTS",
  "TOP_PRODUCTS",
  "EXPLAIN_PRODUCT",
  "CREATE_LANDING_PAGE",
  "GENERATE_CONTENT",
  "LAUNCH_TEST",
  "WHICH_TO_SCALE",
  "WHICH_TO_KILL",
  "HIGH_TRAFFIC_LOW_CONVERSION",
  "RISING_DEMAND_LOW_COMPETITION",
  "RUN_DISCOVERY",
  "HELP",
  "UNKNOWN",
] as const;
export type CommandIntent = (typeof COMMAND_INTENTS)[number];

export const IntentSchema = z.object({
  intent: z.enum(COMMAND_INTENTS),
  productQuery: z.string().nullable(),
  limit: z.number().nullable(),
  maxPrice: z.number().nullable(),
  platform: z.string().nullable(),
  traits: z.array(z.string()),
});
export type ParsedIntent = z.infer<typeof IntentSchema>;
