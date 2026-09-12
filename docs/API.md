# API

Base path: `/api/v1`. All responses are JSON: `{ "data": … }` on success,
`{ "error": { "code", "message", "details?" } }` on failure.

## Authentication

| Method | How | Notes |
|---|---|---|
| Session cookie | `POST /api/auth/login` `{ email, password }` sets an httpOnly `forge_session` cookie | Browser/admin use. Mutations must send a same-origin `Origin` header (CSRF defence) |
| API key | `Authorization: Bearer forge_<prefix>_<secret>` | Create in Settings → API keys. Keys carry a role (admin/operator/viewer), are stored hashed, shown once |

`POST /api/auth/logout` revokes the current session.

**Roles.** viewer: read · operator: products, agents, content, campaigns, affiliate · admin: everything
incl. settings, integrations, users, API keys · automation (API keys only, for n8n): network listings —
discover, ingest, refresh, score, submit, report failures, take listings off the storefront; never
approve or publish (those need a signed-in person, whatever an API key's role). Errors: `401 unauthorized`, `403 forbidden`,
`403 csrf_blocked`, `429 rate_limited` (with `Retry-After`), `400 validation_error` (Zod issues in `details`),
`412 integration_not_configured` (`details.requirements` lists exactly what is missing),
`409 demo_mode_blocked`.

**Rate limits** (per IP, per instance): API 240/min · commands 30/min · login 8/15 min · tracking 120/min ·
redirects 60/min · webhooks 600/min.

## Endpoints

| Method & path | Permission | Description |
|---|---|---|
| `GET /products?status=&q=&maxPrice=&minScore=&model=&sort=&limit=&offset=` | products:read | List (with `provenance` per metric) |
| `POST /products` | products:write | Create (provenance MANUAL) and score |
| `GET /products/{id}` | products:read | Product, category, supplier, latest score breakdown |
| `PATCH /products/{id}` | products:write | Update facts (only changed fields are relabelled MANUAL), re-score |
| `DELETE /products/{id}` | products:delete | Delete |
| `POST /products/{id}/actions` | products:read + action perms | `{ action: "score" \| "start_test" }` run inline; `research` · `launch` · `landing_page` · `content` (with `batch`, `platform`, `contentType`, `count`, `template`) are queued |
| `POST /products/import?model=` | products:write | `text/csv` body or multipart `file` (≤ 5 MB) |
| `POST /discovery` | agents:run | `{ keywords?, firstRun? }` → job |
| `GET /reports?type=TOP5_DAILY\|TOP5_WEEKLY` | reports:read | Latest Top 5 report |
| `POST /reports?type=…` | agents:run | Queue a report |
| `GET /content?productId=&status=&platform=&limit=` | content:read | Content with tracked URLs |
| `GET /content/export?productId=\|ids=&format=json\|csv\|markdown` | content:read | Ready-to-publish package (download) |
| `GET /affiliate-links?productId=` · `POST /affiliate-links` | affiliate:read / write | Tracked links (`trackedUrl` = `/r/{code}`) |
| `POST /conversions` | affiliate:write | Record a conversion from a report (MANUAL, idempotent on `source + externalId`) |
| `GET /analytics/summary?days=30` | analytics:read | KPIs, platforms, countries, leaderboard |
| `GET /recommendations?status=&productId=` | dashboard:read | Metric-backed recommendations |
| `POST /command` `{ input }` | dashboard:read | Natural-language command → result (jobs need agents:run) |
| `POST /jobs` `{ type, payload? }` | jobs:run | Queue any automation (`analytics_sync`, `recommendations_refresh`, `trend_refresh`, …) |
| `GET /jobs/{id}` | dashboard:read | Job status/result |
| `GET /affiliate/providers` | affiliate:read | Affiliate network readiness (missing variable names only) and marketplaces |
| `POST /affiliate/discover` | affiliate:ingest | `{ network?, marketplace?, keywords, category?, limit?, page? }` → official-API search, stored as DISCOVERED |
| `GET /affiliate/products?status=&network=&marketplace=&stale=&hasError=&q=&updatedSince=&sort=` · `POST /affiliate/products` | affiliate:read / ingest | Listing queue (with `total`, `publishBlockers`) · ingest `{ items: [...] }` (≤ 100, upsert) |
| `GET /affiliate/products/{id}` · `PATCH /affiliate/products/{id}` | affiliate:read / ingest | One listing with its storefront product and tracked link · edit FORGE-owned fields `{ revision, … }` (network fields refused; automations only before review) |
| `POST /affiliate/products/{id}/transition` | per action | `{ action: submit\|approve\|reject\|publish\|unpublish\|archive\|restore, note?, revision? }` — publish creates the storefront product and tracked link; approve/publish need a signed-in person |
| `POST /affiliate/products/{id}/score` · `POST /affiliate/products/{id}/failure` | affiliate:ingest | Record a score with provenance · report a failure (optionally unpublish) |
| `POST /affiliate/refresh` | affiliate:ingest | Re-fetch listings older than `olderThanHours` (default 20; Amazon allows 24), published first |
| `GET /affiliate/failures` · `GET /affiliate/tracking?days=&network=&id=` | affiliate:read | Failure feed for automations · per-listing views, outbound clicks, fallbacks, reported conversions |
| `POST /affiliate/conversions` | affiliate:ingest | Network-reported conversions per listing (e.g. Amazon earnings reports), idempotent on `source + orderId`. See [AFFILIATE_PRODUCTS.md](AFFILIATE_PRODUCTS.md) |

### Example

```bash
curl -s -X POST http://localhost:3000/api/v1/products \
  -H "Authorization: Bearer $FORGE_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Mini Thermal Label Printer","businessModel":"AFFILIATE","sellingPrice":39.99,"commissionPercentage":10,"affiliateUrl":"https://…"}'

curl -s -X POST http://localhost:3000/api/v1/products/$ID/actions \
  -H "Authorization: Bearer $FORGE_KEY" -H "Content-Type: application/json" -d '{"action":"launch"}'
# → { "data": { "jobId": 42, "status": "/api/v1/jobs/42" } }
```

## Public endpoints

| Path | Purpose |
|---|---|
| `GET /r/{code}?utm_*&x=&v=` | Tracked outbound redirect. Logs the click (UTMs, A/B experiment `x` + variant `v`, destination host, network listing), appends the network sub-id (click id) when the link's network defines one, 302s to the merchant. Paused/broken links fall back to the product page (logged as `REDIRECT_FALLBACK`) |
| `POST /api/track` | First-party beacon `{ type, path, productId?, landingPageId?, experimentId?, variant?, utm?, referrer? }` → 204. Bots flagged, IP hashed, visitor id only with consent |
| `GET /api/health` | Liveness + DB + queue |
| `GET /sitemap.xml`, `/robots.txt` | SEO |

## Webhooks

**Shopify** — `POST /api/webhooks/shopify`. Verified with HMAC-SHA256 (base64) of the raw body using
`SHOPIFY_CLIENT_SECRET`; de-duplicated by `X-Shopify-Webhook-Id`. Topics: `orders/create`,
`orders/paid` (orders imported), `products/update` / `products/delete` (availability → pause + alert),
`app/uninstalled` (disconnect), compliance topics acknowledged.

**Affiliate postbacks** — `GET|POST /api/webhooks/affiliate/{network-slug}?token=…&click_id=…&order_id=…&amount=…&commission=…&currency=…`.
Generate the URL (with the network's macros pre-filled) in Affiliate → *Generate postback URL*; the
token is compared in constant time; unresolved macros are ignored; idempotent on `order_id`;
the conversion is attributed to its click → product, campaign and content.

**Shopify OAuth** — `GET /api/integrations/shopify/callback` (HMAC + state verified, token encrypted).
