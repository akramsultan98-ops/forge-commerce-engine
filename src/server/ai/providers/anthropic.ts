// Anthropic Claude provider — official @anthropic-ai/sdk.
// Claude Opus 5 / Fable 5.1 requests opt into server-side refusal fallbacks (`fallbacks: "default"`),
// so a policy decline is transparently re-run on Anthropic's recommended fallback model.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { env } from "../../env";
import { extractJson } from "../json";
import { AIProviderError, type AIProvider, type StructuredRequest, type StructuredResult, type TextRequest, type TextResult } from "../types";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS = new Set(["claude-opus-5", "claude-fable-5-1"]);
// `output_config.effort` is accepted by Opus 4.5+, Sonnet 4.6+/5 and Fable; Haiku 4.5 rejects it.
const EFFORT_MODELS = /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|fable)/;

export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic" as const;
  readonly label = "Anthropic Claude";
  private client: Anthropic | null = null;

  isConfigured() {
    return !!env().ANTHROPIC_API_KEY;
  }

  requirements() {
    return ["ANTHROPIC_API_KEY"];
  }

  private sdk(): Anthropic {
    if (!this.client) this.client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 180_000 });
    return this.client;
  }

  private base(req: TextRequest) {
    return {
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: "user" as const, content: req.prompt }],
      ...(FALLBACK_MODELS.has(req.model) ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    };
  }

  private effort(req: TextRequest) {
    return req.effort && EFFORT_MODELS.test(req.model) ? { effort: req.effort } : {};
  }

  private mapError(err: unknown): never {
    if (err instanceof Anthropic.RateLimitError) throw new AIProviderError("Anthropic rate limit reached", this.id, true);
    if (err instanceof Anthropic.AuthenticationError) throw new AIProviderError("Anthropic API key rejected", this.id, false);
    if (err instanceof Anthropic.BadRequestError) throw new AIProviderError(`Anthropic rejected the request: ${err.message}`, this.id, false);
    if (err instanceof Anthropic.APIError) throw new AIProviderError(`Anthropic API error ${err.status}: ${err.message}`, this.id, (err.status ?? 500) >= 500);
    if (err instanceof Anthropic.APIConnectionError) throw new AIProviderError("Could not reach the Anthropic API", this.id, true);
    throw err;
  }

  async generateText(req: TextRequest): Promise<TextResult> {
    try {
      const effort = this.effort(req);
      const msg = await this.sdk().beta.messages.create({ ...this.base(req), ...(Object.keys(effort).length ? { output_config: effort } : {}) });
      if (msg.stop_reason === "refusal") throw new AIProviderError("Claude declined this request", this.id, false);
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return {
        text,
        usage: { inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0), outputTokens: msg.usage.output_tokens },
        model: msg.model,
        provider: this.id,
      };
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      this.mapError(err);
    }
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    try {
      const msg = await this.sdk().beta.messages.parse({
        ...this.base(req),
        output_config: { ...this.effort(req), format: zodOutputFormat(req.schema) },
      });
      if (msg.stop_reason === "refusal") throw new AIProviderError("Claude declined this request", this.id, false);
      let data = msg.parsed_output as T | null;
      if (data === null || data === undefined) {
        const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
        const parsed = req.schema.safeParse(extractJson(text));
        if (!parsed.success) throw new AIProviderError("Claude returned output that failed schema validation", this.id, false);
        data = parsed.data;
      }
      return {
        data,
        usage: { inputTokens: msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0), outputTokens: msg.usage.output_tokens },
        model: msg.model,
        provider: this.id,
      };
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      this.mapError(err);
    }
  }
}

export const anthropicProvider = new AnthropicProvider();
