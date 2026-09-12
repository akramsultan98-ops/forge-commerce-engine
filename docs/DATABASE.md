# Database

PostgreSQL, schema in `src/server/db/schema.ts` (Drizzle ORM), SQL migrations in `drizzle/`.
Drivers: `node-postgres` for `postgres://` URLs; PGlite (PostgreSQL compiled to WASM) for
`pglite://<dir>` / `pglite://memory` — same SQL, used for local dev and the test suite.

```bash
npm run db:generate   # after editing schema.ts → new SQL migration in drizzle/
npm run db:migrate    # apply (advisory-locked; safe when several processes boot at once)
```

## Tables (40)

| Group | Tables |
|---|---|
| Tenancy & identity | `organizations`, `users`, `sessions` (SHA-256 of token), `api_keys` (hashed), `stores` |
| Catalog | `categories`, `suppliers`, `product_sources` (adapter config + encrypted credentials), `products`, `product_stores` |
| Intelligence | `product_signals` (time-series, provenance), `product_scores` (history + factor breakdown), `product_research`, `product_reviews` (real, attributed only), `product_tests`, `product_decisions`, `product_metrics` (daily rollups) |
| Affiliate | `affiliate_networks` (encrypted credentials + postback secret), `affiliate_links` (tracked codes) |
| Marketing | `campaigns`, `content` (also the calendar), `content_assets`, `content_metrics`, `landing_pages`, `landing_page_sections`, `articles`, `experiments`, `newsletter_subscribers` |
| Money & attribution | `click_events`, `conversion_events`, `orders`, `commissions` |
| Outputs | `recommendations`, `reports` |
| Integrations | `integrations` (encrypted tokens), `oauth_states`, `webhook_events` (idempotency) |
| Operations | `jobs`, `job_schedules`, `automation_runs`, `agent_runs`, `ai_usage`, `ai_cache`, `notifications`, `audit_logs`, `api_request_logs`, `settings` |

## Conventions

- UUID primary keys (`gen_random_uuid()`), `jobs.id` is `bigserial`.
- Every business table carries `organization_id` (cascade delete) — services always filter by it.
- Money: `numeric(12,2)` read as JS numbers; AI cost `numeric(12,6)`; scores `double precision`.
- Enums are PostgreSQL enums generated from `src/lib/constants.ts` (single source of truth).
- `is_demo` on every seedable table; analytics exclude demo rows unless `DEMO_MODE=true`.

## Provenance

`products.field_provenance` (jsonb) maps tracked fields → `{ p: REAL|ESTIMATED|AI_INFERENCE|MANUAL|DEMO, source, at }`.
`product_signals.provenance`, `content_metrics.provenance`, `conversion_events.provenance`,
`product_research.provenance` and `generation_method` (AI / TEMPLATE / MANUAL) on generated assets
complete the picture.

## Notable indexes

- `products (organization_id, slug)` unique; `(organization_id, status)`; `(organization_id, overall_score)`;
  partial unique `(organization_id, source, source_product_id)` for idempotent imports.
- `click_events (organization_id, created_at)`, `(product_id, created_at)`, `(organization_id, event_type, created_at)`, `(organization_id, utm_content)`.
- `conversion_events` partial unique `(organization_id, source, external_id)` — postback idempotency.
- `jobs (status, run_at, priority)` for claiming; partial unique `dedupe_key` while queued/running.
- `recommendations` partial unique `(organization_id, fingerprint) where status = 'OPEN'`.
- `content (product_id, utm_content)` partial unique — each post is individually attributable.

## Retention (recommended)

`click_events` 25 months (roll up into `product_metrics` first), `api_request_logs` 90 days,
`ai_cache` by `expires_at`, `sessions` purge expired. These are policy recommendations; add a cron
job for them before large-scale production use.
