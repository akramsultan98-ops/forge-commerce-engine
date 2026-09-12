# FORGE — Autonomous Commerce Engine

**Find Products. Build Offers. Create Content. Generate Sales.**

FORGE is a commerce operating system that runs the loop

> **product → offer → content → traffic → conversion → commission / profit**

It discovers candidate products from official data sources, scores them with an explainable engine,
researches them, generates landing pages and short-form content, tracks every click end to end,
classifies each product test (winner / promising / failure), decides what to scale or kill, and
recommends the next action — all from one command center.

The design goal is **time from "find me a promising product" to "ready to publish"**: one click on
*Launch kit* produces research, a score, a landing page, ten short-form scripts with tracked links
and a campaign — as a background job.

> **Honesty rules are built in.** Every metric stores its provenance (`REAL`, `ESTIMATED`,
> `AI_INFERENCE`, `MANUAL`, `DEMO`). FORGE never fabricates sales numbers, reviews, testimonials,
> scarcity or countdowns, never fakes an integration, and labels demo data as demo data.

## Status

**Local milestone closed (2026-09-12).** FORGE runs locally in Docker Compose (PostgreSQL + web +
worker) with `DEMO_MODE=true`; typecheck, lint, 171 tests and the production build pass, and
`/api/health` reports `ok`. No live credentials, no deployment, no domain yet.

Next milestone: UI polish · product images · real integrations tested against live accounts ·
live credentials · production deployment · domain and HTTPS. Details and the full ledger:
[docs/STATUS.md](docs/STATUS.md).

---

## Quick start (no Docker needed)

```bash
npm install
cp .env.example .env            # then generate the two secrets below
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # → ENCRYPTION_KEY
npm run db:seed                 # migrations + clearly-labelled DEMO data (needs DEMO_MODE=true)
npm run admin:create -- --email=you@example.com --name="You"   # prints a generated password
npm run dev                     # http://localhost:3000  ·  command center: /admin
```

The default `DATABASE_URL=pglite://./.data/pglite` runs a real embedded PostgreSQL (PGlite) in the
web process, with the job runner embedded too. Stop `npm run dev` before running CLI commands
against the embedded database (it is single-process).

### With Docker (PostgreSQL + web + worker)

```bash
cp .env.example .env   # set AUTH_SECRET, ENCRYPTION_KEY, APP_URL, DEMO_MODE
docker compose up -d --build
docker compose run --rm migrate node dist/cli.cjs admin:create --email=you@example.com --name="You"
docker compose run --rm migrate node dist/cli.cjs seed        # optional: labelled demo data
```

Locked out? `docker compose run --rm migrate node dist/cli.cjs admin:reset-password --email=you@example.com`
prints a one-time password and signs the account out everywhere.

See [docs/SETUP.md](docs/SETUP.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## What's inside

| Area | What it does |
|---|---|
| Product discovery | Adapter architecture: CSV/feeds, affiliate product feeds, CJdropshipping API, Shopify catalog, Wikimedia interest signals; AliExpress/Amazon/TikTok Shop as documented interfaces |
| Scoring engine | 9 weighted factors (configurable), reasons + warnings, confidence from data provenance, compliance risk flags |
| Research agent | Investment-style thesis: *TEST THIS PRODUCT BECAUSE…* / *DO NOT TEST…* |
| Top 5 report | Daily/weekly, 17 fields per product including source evidence |
| Landing pages | Section builder, templates A–E, SEO metadata, JSON-LD, A/B experiments |
| Content engine | TikTok/Reels/Shorts scripts (hook 0–3s → problem → demo → payoff → CTA, 14 angles), pins, posts, carousels; calendar; package export |
| Attribution | First-party tracking, `/r/{code}` tracked redirects, UTMs, signed affiliate postbacks, Shopify orders |
| Testing & decisions | WINNER / PROMISING / FAILURE → SCALE / TEST MORE / OPTIMIZE / CONTENT MORE / PAUSE / KILL |
| Recommendations | Metric-backed actions ("2.8× more clicks than average → generate more content") |
| Orchestrator + 9 agents | Research, trend, scoring, copywriting, landing page, content, analytics, optimization, reporting |
| AI providers | Anthropic (official SDK), OpenAI, Google, OpenRouter, local — routed by task tier, budgeted, cached, costed; deterministic template engine when AI is off |
| Command center | "Which product should I scale?" → queries and background jobs |
| Storefront | Editorial light storefront, EN/AR (RTL), 6 currencies, legal pages, cookie consent |
| Ops | Postgres job queue + cron, audit log, API request log, health checks, AI usage dashboard |

## Tech stack

Next.js 16 (App Router, Server Components, Server Actions, `proxy.ts`) · React 19 · TypeScript ·
Tailwind CSS 4 · PostgreSQL via Drizzle ORM (PGlite for dev/tests) · Zod · Vitest · Playwright ·
`@anthropic-ai/sdk` · Docker.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker` | Standalone job worker (PostgreSQL) |
| `npm run db:migrate` · `db:seed` · `db:reset` · `db:generate` | Database |
| `npm run admin:create -- --email=… --name=… [--role=…] [--password=…]` | Users |
| `npm run forge:first-run` | Discovery → trends → scoring → Top 5 → launch kits |
| `npm test` · `npm run test:e2e` · `npm run acceptance` | Tests |
| `npm run lint` · `npm run typecheck` | Quality |

## Pushing to GitHub

The `origin` remote in this clone is a placeholder (`YOUR_USERNAME`). Point it at your repository and
authenticate once, then push:

```bash
git remote set-url origin https://github.com/<your-username>/forge-commerce-engine.git
gh auth login            # or sign in through Git Credential Manager on first push
git push -u origin main
```

Never commit `.env` — it holds your secrets and is ignored by `.gitignore`.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Setup](docs/SETUP.md) · [Deployment](docs/DEPLOYMENT.md) ·
[API](docs/API.md) · [Database](docs/DATABASE.md) · [Automations](docs/AUTOMATIONS.md) ·
[AI agents](docs/AI_AGENTS.md) · [Security](docs/SECURITY.md) ·
[Product discovery](docs/PRODUCT_DISCOVERY.md) · [Social integrations](docs/SOCIAL_INTEGRATIONS.md) ·
[Project status](docs/STATUS.md)
