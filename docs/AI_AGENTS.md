# AI agents & providers

## FORGE Orchestrator

```
FORGE ORCHESTRATOR
├── Product Research Agent     research a product, or rank the catalog against market/budget/model/margin/audience
├── Trend Intelligence Agent   refresh interest signals (Wikimedia today; more sources as connected)
├── Product Scoring Agent      9-factor explainable score
├── Copywriting Agent          headlines, benefits, FAQs, hooks, CTAs, email, SEO
├── Landing Page Agent         template A–E page from the copy set
├── Content Agent              short-form scripts (14 angles), Reels, Shorts, Pins, posts, carousels
├── Analytics Agent            rollups, traffic/conversion spikes
├── Optimization Agent         test verdicts, decisions, metric-backed recommendations (+ optional AI layer)
└── Reporting Agent            daily/weekly Top 5
```

Pipelines (`src/server/agents/orchestrator.ts`):

- **launch_test_kit** — research → score → landing page (draft) → 10 TikTok scripts scheduled daily →
  tracked `/r/` link → product APPROVED ("ready to publish"). This is the core "discovery → first test" path.
- **first_run** — discovery → trends → scoring → Top 5 report → launch kit for each of the top five.
- **daily_cycle** — trends → discovery → scoring → analytics → optimization → daily report.
- **discover** — discovery across configured sources.

Every run is an `agent_runs` row: input, output, logs, duration, parent run, and the tokens/cost of its AI
calls. Adding an agent = implement `AgentDef` (`name`, `title`, `description`, `tier`, `run(ctx, input)`) and
register it in `agents/registry.ts`.

## Provider interface

```ts
interface AIProvider {
  id; label; isConfigured(); requirements();
  generateText(req): Promise<TextResult>;
  generateStructured<T>(req & { schema: ZodType<T> }): Promise<StructuredResult<T>>;
}
```

Domain operations (analyzeProduct → research agent, generateVideoScript → content agent,
generateImagePrompt → `templateImagePrompt`/AI) are built on the two primitives in `AIService`, so no
feature depends on one vendor.

| Provider | Implementation | Default fast / strong |
|---|---|---|
| Anthropic | official `@anthropic-ai/sdk`, structured outputs (`output_config.format`) | `claude-haiku-4-5` / `claude-opus-5` |
| OpenAI | Chat Completions, `json_schema` response format | `gpt-5-mini` / `gpt-5` (verify) |
| Google | Gemini `generateContent`, JSON mode | `gemini-2.5-flash` / `gemini-2.5-pro` (verify) |
| OpenRouter | OpenAI-compatible | `anthropic/claude-haiku-4-5` / `anthropic/claude-opus-5` |
| Local | Any OpenAI-compatible server (Ollama, LM Studio, vLLM) | configurable |

Claude Opus 5 requests opt into Anthropic's server-side refusal fallbacks
(`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`). Refusals are handled, never
returned as content.

## Routing, cost and caching (`src/server/ai/service.ts`)

- Each task (`research`, `copywriting`, `landing_page`, `content`, `recommendations`, `command`, `report`,
  `scoring_assist`) maps to a **fast** or **strong** tier — configurable in Settings → AI.
- **Budget** — month-to-date estimated spend is checked before each call; over budget → template engine.
- **Cache** — identical (provider, model, schema, prompt) requests are served from `ai_cache` (default 7 days).
- **Usage** — every call (including cache hits, failures and template runs) is written to `ai_usage` with
  tokens and estimated cost → `/admin/ai-usage`.

## The template engine (no-AI mode)

When DEMO_MODE is on, no provider is configured, the budget is exhausted or a call fails, the same
schemas are filled by `src/server/ai/templates.ts`: deterministic, rule-based copy that restates only
facts in the product's `ProductBrief`. Output is labelled **TEMPLATE**, never "AI". It never invents
ratings, reviews, numbers, scarcity or results — enforced by tests (`tests/unit/templates.test.ts`).

## Guardrails in every prompt

System prompt: direct, human, not corporate or spammy; never invent reviews, testimonials, sales
numbers, ratings, scarcity, countdowns, awards or authority; no medical/health/safety claims; use only
the fact sheet and say when data is missing. AI factor estimates are stored as `AI_INFERENCE` and never
overwrite real or operator data.
