# FORGE — Project status

_Last updated: 2026-09-12 — local milestone closed._

FORGE runs end to end on a local machine in Docker Compose with `DEMO_MODE=true`. No live
credentials are configured, nothing is deployed, and no domain or HTTPS is set up. This page is the
honest ledger: what works and was verified, what is demo, and what the next milestone has to do.

## Verification (this milestone)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | 0 errors |
| Lint | `npm run lint` | 0 errors |
| Unit + integration tests | `npm test` | 15 files, 171/171 passing (PGlite in-memory DB) |
| Production build | `npm run build` + `npm run build:worker` | Success; `dist/worker.cjs`, `dist/cli.cjs` |
| Docker image | `docker compose build` | Success (`forge-app:latest`, ~370 MB) |
| Docker Compose | `docker compose up -d` | `db` healthy · `migrate` exited 0 (migrations `0000_init`, `0001_shopify_order_lines`) · `app` healthy · `worker` running |
| Health | `GET http://localhost:3000/api/health` | 200 `{"status":"ok","db":"ok","dbDriver":"postgres","jobRunner":"external","demoMode":true}` |

The route crawl (67/67), acceptance script (17/17) and Playwright E2E (10/10) passed on the previous
milestone (`9e69cf9`); they were not re-run for this one. The Docker database is fresh: open
`http://localhost:3000/admin/setup` to create the first admin, and load labelled demo data with
`docker compose run --rm migrate node dist/cli.cjs seed` if you want it there.

## This milestone — hardening

- **Trusted client IPs.** The server stamps every request with its real TCP peer (signed per process,
  installed from `instrumentation.ts`) because Next.js only fills `X-Forwarded-For` when a client did
  not send one. `X-Forwarded-For` is honoured only from peers listed in the new `TRUSTED_PROXIES`
  (IPs, CIDR blocks, `loopback` / `private` / `linklocal`); empty = ignored. Rate limits, audit IPs,
  API logs and the newsletter form all use it. A malformed value stops the server at boot.
- **Account recovery.** `admin:reset-password --email=… [--password-stdin | --password=…] [--enable]`
  sets a new password (generated and shown once by default), revokes every session and writes an
  audit entry without the password.
- **Shopify order accuracy.** Orders are stored one row per line item (revenue after discounts and
  refunds, cost from the product sold). Webhook replays, updates, refunds and cancellations update
  rows in place; older deliveries never overwrite newer state; legacy whole-order rows are replaced.
  Webhooks are routed by the sending store; single-token setups can use `SHOPIFY_WEBHOOK_SECRET`.
  Webhooks are registered automatically after an OAuth connect (and on demand from Admin → Shopify).
  Refund webhooks re-read the order; the sync re-reads orders by `updated_at`. A webhook that failed
  to process is no longer recorded as seen, so Shopify's retry is processed.
- **Analytics.** Order counts are distinct orders; refunded, cancelled, pending and voided lines are
  excluded from revenue, profit, leaderboards, attribution and daily rollups.
- **Background jobs.** Running jobs heartbeat their lock; completion is fenced on owner and attempt;
  only silent jobs are recovered (and failed once attempts run out). A timeout aborts the handler's
  signal (agents and AI calls stop at their next step), fails the job terminally — it is never re-run
  automatically — and any late result is discarded and logged.

## What is built

- **Discovery → decision**: source adapters (manual CSV, affiliate CSV feed, CJdropshipping API,
  Shopify catalog, Wikipedia interest; AliExpress / Amazon / TikTok Shop as setup-state interfaces),
  products with per-field provenance, the 9-factor 0–100 scoring engine with reasons and warnings,
  risk checks, the research agent and the Top 5 report.
- **Offer → content**: business-model engine, product-page generator, landing-page builder (A–E),
  copywriter, social content engine (14 angles), content calendar, guides, SEO.
- **Traffic → money**: `/r/{code}` tracked links with UTMs and A/B variants, consent-gated first-party
  events, affiliate postbacks, Shopify webhooks and sync, analytics dashboard, testing and kill/scale
  engine, experiments, recommendations.
- **Operations**: orchestrator + 9 agents, Postgres job queue and worker with cron schedules, command
  center, notifications, AI usage dashboard, logs, settings, EN/AR (RTL), six display currencies.

## Demo mode

`DEMO_MODE=true` stays on for this milestone. It blocks outbound email, Telegram, social publishing,
Shopify writes and sync, and paid AI calls (the deterministic template engine writes copy instead).
Seeded demo rows are flagged and labelled "Demo" and link to `example.com`.

## Remaining work — next milestone

1. **UI polish** — admin copy is English-first; a pass on spacing, empty states and mobile admin
   details; legal pages are English-only templates to be reviewed by counsel.
2. **Product images** — products currently show generated line-art placeholders; real imagery
   (supplier images under licence, or own photography) and an asset storage backend are not done.
3. **Real integrations** — Shopify, affiliate networks (CJ field mapping), CJdropshipping, social
   direct publishing, email and Telegram are implemented but untested against live accounts. Social
   publishing still needs OAuth connection flows, token refresh and a job that publishes scheduled
   posts. AI prices other than Anthropic's are unverified.
4. **Live credentials** — none are configured. They belong in `.env` / encrypted integration
   settings only, and `DEMO_MODE=false` is a deliberate go-live step.
5. **Production deployment** — nothing is deployed. Needed: managed PostgreSQL or a backed-up volume
   with scheduled `pg_dump` and a tested restore, a production compose override, log shipping or
   `ERROR_TRACKING_DSN`, and a shared rate-limit store before running more than one web instance.
6. **Domain and HTTPS** — no domain or TLS. Needed: a reverse proxy (e.g. Caddy) terminating HTTPS,
   `APP_URL=https://…` (Secure cookies; Shopify only delivers webhooks over HTTPS), and
   `TRUSTED_PROXIES` set to that proxy's address only.

Also open: 2FA, a data-retention job for `click_events`, per-currency normalisation in analytics,
`ENCRYPTION_KEY` rotation tooling, and verifying client-IP resolution behind the real proxy.

## Needs your credentials (when the time comes)

| Area | Where | Needs |
| --- | --- | --- |
| AI copy/research | `.env` (status in Settings → AI) | `ANTHROPIC_API_KEY` (or OpenAI / OpenRouter / Google / local endpoint) |
| Shopify | Admin → Shopify | App client ID/secret + OAuth install, or `SHOPIFY_SHOP_DOMAIN` + `SHOPIFY_ACCESS_TOKEN` (+ `SHOPIFY_WEBHOOK_SECRET`) |
| Affiliate networks | Admin → Affiliate networks | Network API keys + postback token |
| Email | Settings → Notifications | Resend API key, verified `EMAIL_FROM` domain |
| Telegram | Settings → Notifications | Bot token + chat ID |
| Social publishing | `.env` | Per-platform tokens listed in `SOCIAL_INTEGRATIONS.md` |
| Production DB | `.env` | `DATABASE_URL` for PostgreSQL 15+ |

## Security status

- Passwords: scrypt. Sessions: random tokens stored as SHA-256 hashes, HTTP-only cookies, revoked on
  logout, disable and password reset.
- RBAC (admin / operator / viewer) enforced server-side on every page, action and API route.
- Client IPs resolved from the TCP peer; forwarding headers only from `TRUSTED_PROXIES`.
- CSP with per-request nonce, CSRF origin checks, SSRF-safe fetch, AES-256-GCM credentials at rest,
  HMAC/token-verified and de-duplicated webhooks, audit log.
- `npm audit --omit=dev`: 0 known vulnerabilities in production dependencies (2026-09-12).
- No secrets in the repository: `.env*` (except `.env.example`), `.data/` and `dist/` are ignored.
