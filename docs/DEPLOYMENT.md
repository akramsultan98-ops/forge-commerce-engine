# Deployment

## Topology

One image, three roles:

| Role | Command | Scale |
|---|---|---|
| web | `node server.js` (Next.js standalone) | horizontally, behind a TLS reverse proxy |
| worker | `node dist/worker.cjs` | 1…N (jobs are claimed with `FOR UPDATE SKIP LOCKED`) |
| migrate | `node dist/cli.cjs migrate` | one-shot before each release (advisory-locked) |

Production requires **PostgreSQL** (≥ 14). PGlite is for development and tests only.

## Docker Compose

```bash
cp .env.example .env    # production values (see checklist)
docker compose up -d --build
docker compose run --rm migrate node dist/cli.cjs admin:create --email=you@example.com --name="You"
docker compose logs -f app worker
```

`docker-compose.yml` runs `db` (postgres:17), `migrate` (runs once, then app and worker start),
`app` (port 3000, healthcheck on `/api/health`) and `worker`. Put Caddy/Nginx/Traefik in front for TLS.

## Other platforms

- **VPS / container platforms (Fly, Render, Railway, ECS, Kubernetes)** — deploy the image twice (web
  and worker commands) plus a release-phase migrate command; use managed Postgres.
- **Vercel / serverless** — the web app works, but set `JOB_RUNNER=external` and run the worker
  elsewhere (a container or VM); serverless functions cannot host the long-running job loop.

## Production checklist

- [ ] `DEMO_MODE=false` (otherwise all outbound actions stay blocked by design)
- [ ] `AUTH_SECRET`, `ENCRYPTION_KEY` — 32 random bytes each; the app refuses to start without them
- [ ] `APP_URL=https://…` (enables `Secure` cookies and correct OAuth/postback URLs)
- [ ] `DATABASE_URL` to managed PostgreSQL with TLS, a least-privilege role (no superuser)
- [ ] `JOB_RUNNER=external` on web; at least one worker running
- [ ] AI provider key + monthly budget (Settings → AI); verify non-Anthropic prices
- [ ] Email (`EMAIL_PROVIDER_KEY`, `EMAIL_FROM`) and/or Telegram for alerts
- [ ] Shopify app secrets and webhooks registered to `/api/webhooks/shopify`
- [ ] Affiliate network postback URLs generated (Affiliate → Generate postback URL)
- [ ] `ERROR_TRACKING_DSN` (Sentry-compatible) or log shipping for the JSON logs
- [ ] Legal pages reviewed by counsel (templates in `src/content/legal.ts`)
- [ ] Backups: daily `pg_dump` / PITR on the managed database
- [ ] Rotate `ENCRYPTION_KEY` only with a re-encryption plan (stored credentials depend on it)

## Operations

- **Health** — `GET /api/health` (DB round-trip, queue depth, failed jobs in 24 h). `/admin/logs?tab=health` for details.
- **Logs** — structured JSON on stdout (secrets redacted). Job, automation, agent, audit and API logs are in the database and visible under `/admin/logs` and `/admin/agents`.
- **Scaling** — web is stateless except the in-memory rate limiter (per instance; see SECURITY.md).
- **Upgrades** — build → run `migrate` → roll web and workers.
