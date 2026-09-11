import type { z } from "zod";

export const PROVIDER_IDS = ["anthropic", "openai", "google", "openrouter", "local"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ModelTier = "fast" | "strong";

export interface AIUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextRequest {
  model: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** Anthropic effort / reasoning depth hint; providers that lack it ignore it. */
  effort?: "low" | "medium" | "high";
}

export interface TextResult {
  text: string;
  usage: AIUsage;
  model: string;
  provider: ProviderId;
}

export interface StructuredRequest<T> extends TextRequest {
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface StructuredResult<T> {
  data: T;
  usage: AIUsage;
  model: string;
  provider: ProviderId;
}

/**
 * Provider-agnostic contract. Every provider implements the two primitives; domain-level
 * operations (analyzeProduct, generateVideoScript, generateImagePrompt…) are built on top of
 * them in AIService so no feature is ever hard-wired to one vendor.
 */
export interface AIProvider {
  readonly id: ProviderId;
  readonly label: string;
  isConfigured(): boolean;
  /** Exactly what an operator must configure to enable this provider. */
  requirements(): string[];
  generateText(req: TextRequest): Promise<TextResult>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public provider: ProviderId,
    public retryable = false,
  ) {
    super(message);
    this.name = "AIProviderError";
  }
}
