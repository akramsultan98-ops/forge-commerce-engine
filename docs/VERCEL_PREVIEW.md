# Vercel Preview (temporary, demo-only)

A private, disposable preview of FORGE on Vercel so the UI can be reviewed from any device. It is
**not** production: `DEMO_MODE=true`, no database server, no worker, no credentials, no domain.

## Verdict

FORGE builds and runs on Vercel as a standard Next.js app. Verified locally with a Vercel-like build
(`VERCEL=1` plus preview system variables, clean checkout without `.env`, then the production server):

| Check | Result |
| --- | --- |
| Build with **no** FORGE variables | Succeeds (the build needs no secrets) |
| Build with the preview variables below | Succeeds; server output 61 MB (Vercel limit 250 MB) |
| Cold start | ~11 s: in-memory PostgreSQL migrated in ~4 s, labelled demo data seeded in ~7 s (20 products, ~16k events) |
| Route crawl (signed in) | 67/67 admin + storefront routes render |
| Playwright E2E (desktop + mobile) | 10/10 |
| Same build with **no** variables (what an unconfigured Production deployment does) | Every route returns `500` — `Invalid production configuration: AUTH_SECRET is not set; ENCRYPTION_KEY is not set` — no data, no setup page |

It has not been deployed to Vercel itself yet; the differences to expect are listed under limitations.

## How the preview works

- **Database — none to host.** `DATABASE_URL=pglite://memory` gives every Vercel function instance its
  own in-memory PostgreSQL (PGlite). On a cold start it runs the migrations (the SQL files ship with the
  functions via `outputFileTracingIncludes`) and, with `DEMO_SEED_ON_BOOT=true`, loads the labelled demo
  data. Nothing persists: data resets on every cold start and redeploy, and instances do not share it.
- **No background worker.** `JOB_RUNNER=off`. Anything that enqueues a job stays *queued* — nothing
  pretends to have run.
- **Admin.** The first visit to `/admin` on a fresh instance opens `/admin/setup`, which creates a
  throwaway admin in that instance only.
- **URLs.** With `APP_URL` unset, FORGE uses the deployment's own `https://` URL (the branch URL for
  previews), so canonical URLs, redirects and tracked links point at the preview, not `localhost`.

## Exact Vercel settings

Import `akramsultan98-ops/forge-commerce-engine` as a new project (Add New → Project).

| Setting | Value |
| --- | --- |
| Framework Preset | Next.js |
| Root Directory | `./` (leave empty) |
| Build Command | default (`next build`) — do not override |
| Output Directory | default |
| Install Command | default (`npm ci`, from `package-lock.json`) |
| Node.js Version (Settings → Build and Deployment) | 24.x (the default) |
| Fluid compute / region | defaults (on / `iad1`) |
| Environment variables on the import screen | **none** — they would also apply to Production |
| Settings → Environments → Production → Branch Tracking | a branch that does not exist, e.g. `production` — every push to `main` then creates a **Preview** |
| Settings → Deployment Protection | Vercel Authentication, **Standard Protection** (protects previews and deployment URLs) |
| Settings → Environment Variables → system variables | "Automatically expose System Environment Variables" enabled (needed for the automatic `APP_URL`) |
| Domains | none |

On the Hobby plan the **production** `*.vercel.app` domain cannot be protected. Vercel always makes a new
project's first deployment a production deployment; with no Production variables it only returns `500`,
so it exposes nothing. Do not "Redeploy" it — that deploys to Production again.

## Environment variables — Preview scope only

Add these under Settings → Environment Variables with **only "Preview"** ticked. Mark the two secrets
as *Sensitive*.

| Name | Value | Why |
| --- | --- | --- |
| `DEMO_MODE` | `true` | Hard-blocks every outbound action (email, Telegram, social, Shopify, paid AI) |
| `DATABASE_URL` | `pglite://memory` | In-memory PostgreSQL per instance; the default file path is read-only on Vercel |
| `DEMO_SEED_ON_BOOT` | `true` | Loads the labelled demo data on each cold start (embedded database only) |
| `JOB_RUNNER` | `off` | There is no worker on Vercel |
| `AUTH_SECRET` | new random value, preview-only | Required when `NODE_ENV=production` (Vercel sets it) |
| `ENCRYPTION_KEY` | new random value, preview-only | Required when `NODE_ENV=production` |
| `TRENDS_WIKIPEDIA_ENABLED` | `false` | Recommended: no outbound calls at all |

Generate each secret separately (run it twice — the two values must differ) with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. Each must be at least
32 characters, pasted without quotes or spaces. Never reuse the values from your local `.env`.

### If a deployment fails with "Invalid production configuration"

The message names each invalid variable, the reason (not set, placeholder, too short, quoted, spaces,
not random, identical) and, on Vercel, the environment the deployment runs in. Check, in order:

1. **Environment** — the variable must be ticked for the environment shown in the message
   (`production` or `preview`). A deployment's environment is shown on its page in Deployments.
2. **Redeploy** — variables are fixed when a deployment is created; after adding or changing one,
   create a new deployment (push a commit, or Deployments → ⋯ → Redeploy). The old one keeps failing.
3. **Value** — a newly generated value, not the `.env.example` placeholder (watch for variables
   brought in through "Import .env"), without quotes, and different for the two secrets.

If you deploy to **Production** instead of Preview, all seven variables above must be set for
Production; otherwise the next failure is the default file-backed `DATABASE_URL` on Vercel's read-only
filesystem.

**Do not add** anything else. In particular, do not use "Import .env" with the ~57 detected variables:

- `APP_URL` (derived automatically), `NODE_ENV` (set by Vercel), `TRUSTED_PROXIES`
- AI: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `OPENROUTER_API_KEY`, `LOCAL_AI_*`
- Shopify: `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`
- Notifications: `TELEGRAM_*`, `EMAIL_PROVIDER_KEY`, `EMAIL_FROM`, `ALERT_EMAIL_TO`
- Affiliate and sources: `AFFILIATE_API_KEYS`, `AFFILIATE_POSTBACK_SECRET`, `CJ_API_KEY`, `ALIEXPRESS_*`, `AMAZON_PAAPI_*`
- Social: `TIKTOK_*`, `META_*`, `FACEBOOK_*`, `INSTAGRAM_*`, `YOUTUBE_*`, `PINTEREST_*`, `X_USER_ACCESS_TOKEN`
- `ANALYTICS_KEYS`, `ERROR_TRACKING_DSN`, and any `DATABASE_URL` that points at a real database

Nothing is added to the **Production** or **Development** environments.

## What works in the preview

- Storefront: home, products, product pages (score breakdown, JSON-LD), categories, trending, best
  products, guides, landing pages, legal pages, sitemap, robots, 404, English/Arabic (RTL), currencies,
  cookie banner — all with labelled demo data.
- Admin (after `/admin/setup`): dashboard, command center queries, Top 5 reports, products and their
  research/content/landing/analytics tabs, discovery, testing, winners, landing-page builder, content and
  calendar, guides, campaigns, experiments, analytics, affiliate networks, Shopify and sources setup
  states, agents, AI usage, logs, settings — reading and editing data inside the instance.
- Tracked redirects `/r/{code}` (demo destinations are `example.com`), `/api/health`.

## What does not work in the preview

- **Persistence**: data and admin accounts reset on every cold start or redeploy; parallel instances do
  not share data, so a session can drop and `/admin/setup` appears again.
- **Background jobs** (`JOB_RUNNER=off`): discovery, launch kits, research refresh, content and landing
  generation jobs, Top 5 generation, scheduled automations, notification delivery, Shopify sync — they are
  queued and never run.
- **Outbound actions** (`DEMO_MODE`): email, Telegram, social publishing, Shopify writes, paid AI (the
  template engine writes copy instead).
- **Real integrations**: Shopify OAuth and webhooks, affiliate postbacks, AI providers — no credentials.
- **Uploads over 4.5 MB** (Vercel request-body limit; the CSV importer allows 5 MB locally).
- **Per-IP rate limits** are per instance and coarse (no trusted proxy configured) — fine for a reviewer.
- **First request after idle** waits for the ~10–20 s cold start.

## Compatibility audit

| Routes | Needs | On the preview |
| --- | --- | --- |
| Static assets (`/_next/static`, `/icon.svg`) | nothing | served by Vercel's CDN |
| Storefront pages, `/sitemap.xml`, `/admin/*`, `/api/*` | a PostgreSQL database | in-memory PGlite per instance |
| Job-triggering actions and APIs (launch kit, discovery, generate, `/api/v1/jobs`, `/api/v1/discovery`, scheduled automations) | the background worker | queued only |
| Anything that needs Docker | — | none: Docker only packages PostgreSQL, the web app and the worker |
| Shopify callback and webhooks, affiliate postbacks, social publish, email/Telegram, AI, CJ/feed discovery, Wikipedia trends | external services and credentials | disabled, blocked by `DEMO_MODE`, or setup state |

Build/runtime incompatibilities found and handled: the default file-backed database path (read-only on
Vercel → use `pglite://memory`); migrations not shipped with the functions (fixed with
`outputFileTracingIncludes`); `APP_URL` pointing at `localhost` (derived from Vercel's system variables).
Remaining: the 4.5 MB body limit and the absence of a long-running worker.

## Optional later: a persistent preview

If the review needs data that survives restarts, create a free Postgres dedicated to the preview (for
example Neon from the Vercel Marketplace), set its **pooled** URL as `DATABASE_URL` for Preview only, and
prepare it once from your machine with its **direct** URL (shell variables take precedence over `.env`):

```bash
DATABASE_URL="<direct preview URL>" DEMO_MODE=true npx tsx scripts/cli.ts migrate
DATABASE_URL="<direct preview URL>" DEMO_MODE=true npx tsx scripts/cli.ts seed
DATABASE_URL="<direct preview URL>" npx tsx scripts/cli.ts admin:create --email=you@example.com --name="You"
```

`DEMO_SEED_ON_BOOT` is ignored on PostgreSQL. Jobs still need a worker; `jobs:drain` run the same way
processes queued jobs once. That database is a new credential — keep it preview-only, never production.

## Keeping local Docker working

- `Dockerfile` and `docker-compose.yml` are unchanged; the local `.env` is never uploaded (Vercel builds
  from Git, and `.env` is git-ignored).
- `DEMO_SEED_ON_BOOT` defaults to `false`; the `APP_URL` fallback only applies when `VERCEL=1`; shipping
  `drizzle/` in the server output is harmless for PostgreSQL. `docker compose build` succeeds with these
  changes and the running stack keeps working.

## Removing the preview

Delete the Vercel project (Settings → General → Delete Project). There is no data to clean up.
