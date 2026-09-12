# Setup

## Requirements

- Node.js ≥ 20.9 (developed on Node 24) and npm
- Optional: Docker (PostgreSQL), a Chromium download for Playwright (`npx playwright install chromium`)

## 1. Install and configure

```bash
npm install
cp .env.example .env
```

Generate secrets (never commit `.env`):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
```

Important variables (full list in `.env.example`):

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Canonical URLs, OAuth callbacks, tracked links |
| `DEMO_MODE` | `true` | Seeds demo data; blocks emails, posts, Shopify writes, orders and paid AI calls |
| `DATABASE_URL` | `pglite://./.data/pglite` | Or `postgres://user:pass@host:5432/db` |
| `JOB_RUNNER` | `embedded` | `external` when running `npm run worker` separately (Postgres only) |
| `AUTH_SECRET`, `ENCRYPTION_KEY` | — | Required (≥ 32 chars) in production |
| `ANTHROPIC_API_KEY` etc. | empty | Without keys the template engine is used |

## 2. Database

**Embedded (default).** `pglite://./.data/pglite` stores a real PostgreSQL database on disk. It is
single-process: the web server holds the lock, so stop `npm run dev` before CLI commands
(`db:seed`, `admin:create`, `forge:first-run`).

**PostgreSQL.**

```bash
docker compose up -d db
# .env: DATABASE_URL=postgres://forge:forge@localhost:5432/forge
npm run db:migrate
```

Migrations live in `drizzle/`. After changing `src/server/db/schema.ts`: `npm run db:generate`.

## 3. Data and users

```bash
npm run db:seed                                   # DEMO data (requires DEMO_MODE=true)
npm run admin:create -- --email=you@example.com --name="You"            # prints a generated password
npm run admin:create -- --email=ops@example.com --name=Ops --role=operator --password='…'
```

Alternatively open `/admin/setup` on a fresh database to create the first admin in the browser.

## 4. Run

```bash
npm run dev          # web + embedded job runner
# with PostgreSQL you can split roles:
JOB_RUNNER=external npm run dev
npm run worker       # in another terminal; scale to N workers
```

Storefront: `http://localhost:3000` · Command center: `http://localhost:3000/admin`.

## 5. First-run discovery workflow

Admin → Discover → **Run first-run workflow** (or `npm run forge:first-run` with the server
stopped). It runs discovery on every configured source, pulls real Wikimedia interest signals,
scores everything, writes the Top 5 report and generates a launch kit for each of the top five.
Without live sources the results are labelled **DEMO DATA**.

## 6. Tests

```bash
npm test                          # unit + integration (in-memory PostgreSQL), ~10 s
npm run test:e2e                  # Playwright desktop + mobile; needs `npm run build` or a running server
E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e          # includes the admin flow
ACCEPTANCE_EMAIL=… ACCEPTANCE_PASSWORD=… npm run acceptance   # section-63 workflow over HTTP
```

## Troubleshooting

- **`PGlite` lock / "database is locked"** — another process has the embedded DB open. Stop it.
- **Reset local data** — `npm run db:reset` (refused in production), then `npm run db:seed`.
- **Wikimedia signals missing** — set `TRENDS_WIKIPEDIA_ENABLED=true` and give products a
  `trend keyword` (an English Wikipedia article title).
