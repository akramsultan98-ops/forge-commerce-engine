// Google Gemini provider (Generative Language REST API).

import { env } from "../../env";
import { extractJson, schemaInstruction } from "../json";
import { AIProviderError, type AIProvider, type StructuredRequest, type StructuredResult, type TextRequest, type TextResult } from "../types";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

export class GoogleProvider implements AIProvider {
  readonly id = "google" as const;
  readonly label = "Google Gemini";

  isConfigured() {
    return !!env().GOOGLE_AI_API_KEY;
  }

  requirements() {
    return ["GOOGLE_AI_API_KEY"];
  }

  private async call(req: TextRequest, json: boolean): Promise<TextResult> {
    const body = {
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      contents: [{ role: "user", parts: [{ text: req.prompt }] }],
      generationConfig: { maxOutputTokens: req.maxTokens ?? 4000, ...(json ? { responseMimeType: "application/json" } : {}) },
    };
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env().GOOGLE_AI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) throw new AIProviderError(`Gemini error ${res.status}: ${data.error?.message ?? "request failed"}`, this.id, res.status === 429 || res.status >= 500);
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    return {
      text,
      usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
      model: req.model,
      provider: this.id,
    };
  }

  generateText(req: TextRequest) {
    return this.call(req, false);
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const r = await this.call({ ...req, prompt: `${req.prompt}\n\n${schemaInstruction(req.schema)}` }, true);
    const parsed = req.schema.safeParse(extractJson(r.text));
    if (!parsed.success) throw new AIProviderError(`Gemini returned JSON that failed validation: ${parsed.error.issues[0]?.message}`, this.id);
    return { data: parsed.data, usage: r.usage, model: r.model, provider: this.id };
  }
}

export const googleProvider = new GoogleProvider();
