# FORGE — Project status

_Last updated: 2026-09-12._

This page is the honest ledger: what works and was verified, what is demo or mocked, what needs your
credentials, and what is still open before FORGE runs production traffic.

## Verification (this milestone)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 errors |
| Unit + integration tests | `npm test` | 12 files, 110/110 passing (PGlite in-memory DB) |
| Production build | `npm run build` | Success, 67 routes |
| Worker bundle | `npm run build:worker` | `dist/worker.cjs`, `dist/cli.cjs` |
| Route crawl | every admin + storefront route, signed in | 67/67 OK; unknown URL → 404; anonymous `/admin/*` → 307 to login |
| Acceptance (section 63) | `npm run acceptance` | 17/17 HTTP steps passing |
| End-to-end | `npx playwright test` (desktop + Pixel 7) | 10/10 passing |

The Docker image and `docker-compose.yml` were written but **not run** on this machine (Docker daemon
was off). Run `docker compose up --build` once before relying on them.

## What is built

- **Discovery → decision**: source adapters (manual, CSV, URL import, Shopify, affiliate networks,
  trend APIs), product DB with per-field provenance (REAL / ESTIMATED / AI_INFERENCE / MANUAL), the
  9-factor weighted 0–100 scoring engine with reasons, warnings and confidence, risk assessment,
  research agent (TEST / DO NOT TEST thesis) and the Top 5 report.
- **Offer → content**: business-model engine (affiliate / dropshipping / Shopify / landing page),
  product-page generator, landing-page builder (templates A–E), AI copywriter, social content engine
  (TikTok beat structure, 14 angles), content calendar, guides/blog, SEO (metadata, JSON-LD, sitemap).
- **Traffic → money**: `/r/{code}` tracked redirects with UTMs and experiment variants, first-party
  events behind a consent cookie, affiliate postbacks, Shopify webhooks, analytics dashboard,
  testing engine, kill/scale decisions, A/B experiments, recommendations.
- **Operations**: FORGE Orchestrator + 9 agents, Postgres job queue with cron scheduler, command
  center, notifications (dashboard / email / Telegram), AI usage and budget dashboard, logs
  (automations, jobs, audit, API, health), settings, EN/AR with RTL, six display currencies.
- **Storefront**: editorial home, products, categories, trending, best products, guides, legal pages.

## Demo mode and what is mocked

`DEMO_MODE=true` (the default in `.env.example`):

- Seeds 20 products, 5 categories, 3 suppliers, 3 affiliate networks, 10 content items and
  5 campaigns, every row flagged `is_demo` and labelled "Demo" in the UI. Demo links point to
  `example.com`.
- Blocks outbound email, social publishing, real orders and paid AI calls. The AI layer falls back
  to the deterministic template engine, so generated copy is structured but not model-written.
- Demo analytics span ~31 days. The dashboard deliberately shows "prior period incomplete" instead
  of a period-over-period delta until the previous window has data on at least half its days.

A local database seeded before a template change keeps the old generated copy until you re-seed
(`npm run db:reset`, with the server stopped — PGlite is single-process).

## Needs your credentials

Each integration has a setup state in the admin UI and does nothing until configured.

| Area | Where | Needs |
| --- | --- | --- |
| AI copy/research | `.env` (status in Settings → AI) | `ANTHROPIC_API_KEY` (or OpenAI / OpenRouter / Google / local endpoint) |
| Shopify | Admin → Shopify | App client ID/secret, store domain, OAuth install |
| Affiliate networks | Admin → Affiliate networks | Network API keys + postback token |
| Email | Settings → Notifications | SMTP or provider API key |
| Telegram | Settings → Notifications | Bot token + chat ID |
| Social publishing | `.env` | Per-platform tokens listed in `SOCIAL_INTEGRATIONS.md` |
| Production DB | `.env` | `DATABASE_URL` for PostgreSQL 15+ |

## Open before production

- **Rate limiting** is in-memory per process; use a shared store (Redis/Postgres) behind more than
  one instance.
- **Auth**: no 2FA and no password-reset flow yet (`npm run admin:create` only creates new accounts).
- **Social direct-publish** is implemented to the documented APIs but untested against live accounts.
- **CJ Affiliate** field mapping is unverified against a live account.
- **AI pricing**: Anthropic per-token prices in `src/server/ai/pricing.ts` are list prices; other
  vendors' entries are flagged unverified, and unknown models are recorded at cost 0.
- **Docker** images are unverified (see above).
- **Localisation**: storefront is fully EN/AR; admin deep copy and legal templates are English-first.
  Have the legal templates reviewed for your jurisdiction.
- **Data retention**: no scheduled purge of old click events yet.
- **Multi-currency analytics**: revenue sums assume one reporting currency; per-currency
  normalisation of conversions is not implemented.

## Security status

- Passwords: scrypt. Sessions: random tokens stored as SHA-256 hashes, HTTP-only cookies.
- RBAC (admin / operator / viewer) enforced server-side on every page, action and API route.
- API keys `forge_<prefix>_<secret>`, hashed at rest, scoped to the organisation.
- CSP with per-request nonce and `strict-dynamic`, CSRF origin checks on mutations, security headers.
- SSRF-safe fetch validates the resolved IP at connect time; integration credentials are encrypted
  with AES-256-GCM; webhooks are HMAC- or token-verified and deduplicated.
- No secrets in the repository: `.env*` (except `.env.example`), `.data/` and `dist/` are ignored.
  Provider keys are only read on the server and are never sent to the browser.

## Repository

The `origin` remote is still the placeholder `https://github.com/YOUR_USERNAME/forge-commerce-engine.git`,
so nothing has been pushed. See the README's "Pushing to GitHub" steps.
