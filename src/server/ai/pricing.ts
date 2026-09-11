// Per-million-token prices used to estimate AI spend in the usage dashboard.
// Anthropic prices are first-party list prices. Other vendors' entries are UNVERIFIED defaults —
// confirm against the provider's pricing page; unknown models are recorded with cost 0 and flagged.

export interface ModelPrice {
  input: number;
  output: number;
  verified: boolean;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, verified: true },
  "claude-opus-5": { input: 5, output: 25, verified: true },
  "claude-opus-4-8": { input: 5, output: 25, verified: true },
  "claude-sonnet-5": { input: 2, output: 10, verified: true },
  "claude-sonnet-4-6": { input: 3, output: 15, verified: true },
  "claude-haiku-4-5": { input: 1, output: 5, verified: true },
  "gpt-5": { input: 1.25, output: 10, verified: false },
  "gpt-5-mini": { input: 0.25, output: 2, verified: false },
  "gemini-2.5-pro": { input: 1.25, output: 10, verified: false },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, verified: false },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): { cost: number; priced: boolean } {
  const key = Object.keys(MODEL_PRICES).find((k) => model === k || model.endsWith(`/${k}`) || model.startsWith(k));
  if (!key) return { cost: 0, priced: false };
  const p = MODEL_PRICES[key];
  return { cost: (inputTokens * p.input + outputTokens * p.output) / 1_000_000, priced: true };
}

/** Sensible default model pairs per provider (fast tier for simple tasks, strong for research/strategy). */
export const DEFAULT_MODELS: Record<string, { fast: string; strong: string }> = {
  anthropic: { fast: "claude-haiku-4-5", strong: "claude-opus-5" },
  openai: { fast: "gpt-5-mini", strong: "gpt-5" },
  google: { fast: "gemini-2.5-flash", strong: "gemini-2.5-pro" },
  openrouter: { fast: "anthropic/claude-haiku-4-5", strong: "anthropic/claude-opus-5" },
  local: { fast: "llama3.1", strong: "llama3.1" },
};
