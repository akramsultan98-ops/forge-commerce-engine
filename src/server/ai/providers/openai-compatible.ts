// OpenAI Chat Completions–compatible provider. Serves OpenAI, OpenRouter and local servers
// (Ollama / LM Studio / vLLM) — each is a separate provider instance with its own base URL and key.

import { env } from "../../env";
import { extractJson, schemaInstruction, toJsonSchema } from "../json";
import { AIProviderError, type AIProvider, type ProviderId, type StructuredRequest, type StructuredResult, type TextRequest, type TextResult } from "../types";

interface Options {
  id: Extract<ProviderId, "openai" | "openrouter" | "local">;
  label: string;
  baseUrl: () => string;
  apiKey: () => string;
  requirements: string[];
  nativeJsonSchema: boolean;
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export class OpenAICompatibleProvider implements AIProvider {
  readonly id: Options["id"];
  readonly label: string;
  constructor(private opts: Options) {
    this.id = opts.id;
    this.label = opts.label;
  }

  isConfigured(): boolean {
    return this.opts.id === "local" ? !!this.opts.baseUrl() : !!this.opts.apiKey();
  }

  requirements(): string[] {
    return this.opts.requirements;
  }

  private async chat(req: TextRequest, responseFormat?: Record<string, unknown>): Promise<TextResult> {
    const messages = [...(req.system ? [{ role: "system", content: req.system }] : []), { role: "user", content: req.prompt }];
    const body: Record<string, unknown> = { model: req.model, messages };
    const limit = req.maxTokens ?? 4000;
    if (this.id === "openai") body.max_completion_tokens = limit;
    else body.max_tokens = limit;
    if (responseFormat) body.response_format = responseFormat;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = this.opts.apiKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    if (this.id === "openrouter") {
      headers["HTTP-Referer"] = env().APP_URL;
      headers["X-Title"] = "FORGE";
    }
    const res = await fetch(`${this.opts.baseUrl().replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const json = (await res.json().catch(() => ({}))) as ChatResponse;
    if (!res.ok) throw new AIProviderError(`${this.label} error ${res.status}: ${json.error?.message ?? "request failed"}`, this.id, res.status === 429 || res.status >= 500);
    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
      model: req.model,
      provider: this.id,
    };
  }

  generateText(req: TextRequest): Promise<TextResult> {
    return this.chat(req);
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const format = this.opts.nativeJsonSchema
      ? { type: "json_schema", json_schema: { name: req.schemaName.replace(/[^a-zA-Z0-9_-]/g, "_"), schema: toJsonSchema(req.schema), strict: false } }
      : { type: "json_object" };
    const prompt = this.opts.nativeJsonSchema ? req.prompt : `${req.prompt}\n\n${schemaInstruction(req.schema)}`;
    const r = await this.chat({ ...req, prompt }, format);
    const parsed = req.schema.safeParse(extractJson(r.text));
    if (!parsed.success) throw new AIProviderError(`${this.label} returned JSON that failed validation: ${parsed.error.issues[0]?.message}`, this.id);
    return { data: parsed.data, usage: r.usage, model: r.model, provider: this.id };
  }
}

export const openAIProvider = new OpenAICompatibleProvider({
  id: "openai",
  label: "OpenAI",
  baseUrl: () => "https://api.openai.com/v1",
  apiKey: () => env().OPENAI_API_KEY,
  requirements: ["OPENAI_API_KEY"],
  nativeJsonSchema: true,
});

export const openRouterProvider = new OpenAICompatibleProvider({
  id: "openrouter",
  label: "OpenRouter",
  baseUrl: () => "https://openrouter.ai/api/v1",
  apiKey: () => env().OPENROUTER_API_KEY,
  requirements: ["OPENROUTER_API_KEY"],
  nativeJsonSchema: false,
});

export const localProvider = new OpenAICompatibleProvider({
  id: "local",
  label: "Local model (OpenAI-compatible)",
  baseUrl: () => env().LOCAL_AI_BASE_URL,
  apiKey: () => "",
  requirements: ["LOCAL_AI_BASE_URL (e.g. http://localhost:11434/v1)", "LOCAL_AI_MODEL"],
  nativeJsonSchema: false,
});
