import { anthropicProvider } from "./providers/anthropic";
import { googleProvider } from "./providers/google";
import { localProvider, openAIProvider, openRouterProvider } from "./providers/openai-compatible";
import type { AIProvider, ProviderId } from "./types";

export const PROVIDERS: Record<ProviderId, AIProvider> = {
  anthropic: anthropicProvider,
  openai: openAIProvider,
  google: googleProvider,
  openrouter: openRouterProvider,
  local: localProvider,
};

export function getProvider(id: string): AIProvider | null {
  return (PROVIDERS as Record<string, AIProvider>)[id] ?? null;
}

/** Registering a new provider = implement AIProvider and add it here. */
export function providerStatus() {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured(), requirements: p.requirements() }));
}
