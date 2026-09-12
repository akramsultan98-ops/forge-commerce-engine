# Affiliate products (Amazon Egypt first, any network next)

Network product listings — an ASIN on Amazon.eg today, other networks later — enter FORGE through one
network-agnostic model, one review lifecycle, one publishing flow and one API. Network-specific code
lives only in `src/server/affiliate/<provider>/`; everything else uses the generic contract.

```
provider API / n8n ──ingest──▶ affiliate_products ──review──▶ APPROVED ──publish──▶ products (storefront)
                               (source of truth for             (a person)          + affiliate_links (/r/{code})
                                network data)                                        + click_events / conversions
```

## Model: `affiliate_products`

Kept separate from `products` on purpose: `products` is the storefront and research/testing model;
an affiliate listing carries a **review** lifecycle and network data with freshness rules.

| Group | Fields | Who changes them |
| --- | --- | --- |
| Identity | `network`, `networkId`, `marketplace`, `country`, `externalId`, `externalIdType`, `parentExternalId` — unique per org + network + marketplace + id | ingest |
| Network data | `title`, `description`, `features`, `category`, `categoryPath`, `brand`, `merchant`, `productUrl`, `affiliateUrl`, `imageUrls` (links only), `price`, `currency`, `priceDisplay`, `availability`, `availabilityMessage`, `rating`/`reviewCount`/`reviewSource` (only when the network legitimately supplies them — Amazon's Creators API does not), `commissionRate`, `networkMeta` | ingest / refresh only — **never editable** in FORGE |
| Data provenance | `provenance` (REAL from a provider, MANUAL from n8n/API), `ingestSource`, `dataFetchedAt`, `lastSyncError` | ingest / refresh / failure reports |
| FORGE-owned | `categoryId` (storefront category), `summary` (FORGE's own description), `problemSolved`, `targetAudience`, `tags`, `expectedCommissionRate` (from the network's rate card) | people; automations only before review |
| Score | `score`, `scoreProvenance` (AI_INFERENCE / ESTIMATED / MANUAL — never REAL), `scoreSource`, `scoreReasons`, `scoredAt` | automations / operators |
| Lifecycle | `status`, `statusChangedAt`, `reviewedBy`, `reviewNote`, `publishedAt`, `productId`, `revision` | transitions |

`revision` increases with every edit and transition. Clients send the revision they loaded; a mismatch
returns `409 conflict` (concurrent-edit protection). Transitions are also guarded on the current status.

## Lifecycle

```
DISCOVERED ─submit→ REVIEW ─approve→ APPROVED ─publish→ PUBLISHED ─archive→ ARCHIVED
                      └─reject→ REJECTED ─restore→ REVIEW      PUBLISHED ─unpublish→ APPROVED
```

Rules live in `src/domain/affiliate-products.ts`.

| Action | Permission | Who |
| --- | --- | --- |
| submit | `affiliate:ingest` | automation keys, operators, admins |
| unpublish, archive | `affiliate:ingest` | the same — machines may take a broken listing *off* the storefront |
| reject, restore | `affiliate:review` | operators, admins |
| approve, publish | `affiliate:review` **and a signed-in person** | never an API key, whatever its role |

### Publishing blockers

A listing can be published when it has an affiliate URL (the network's tagged link), a product URL, at
least one image, a description (the network's, or a FORGE `summary`), a category (the network's, or a
chosen storefront category), is not out of stock, and its data is fresh (Amazon: fetched less than 24 h
ago). `GET /affiliate/products/{id}` lists the current `publishBlockers`.

## Storefront publishing (`src/server/services/affiliate-publishing.ts`)

Publishing runs in one transaction with the transition:

1. **Product** — the listing's FORGE product is created (or the one it was published to before is
   updated and shown again): `source = AFFILIATE_NETWORK`, `sourceProductId = NETWORK:marketplace:id`,
   business model AFFILIATE, status APPROVED (a product already in testing/scaling keeps its status).
   The storefront category is the chosen one, else an existing FORGE category whose slug matches the
   network category; FORGE never creates categories by itself.
2. **Tracked link** — one primary `affiliate_links` row (`/r/{code}`, `affiliateProductId` = the listing)
   pointing at the network's tagged URL, unmodified. Other links on the product become secondary.
3. **Relationship** — `affiliate_products.product_id` → product; `affiliate_links.affiliate_product_id`
   → listing; tracked clicks record `click_events.affiliate_product_id`.

The listing stays the **source of truth**. Network fields on the product (`title`, `description`,
`brand`, URLs, `imageUrl`/`gallery`, `sellingPrice`/`currency`, `available`, rating fields,
`highlights` = features, `countriesAvailable`) and the listing's FORGE fields are copied onto it on
publish and **on every refresh**; field provenance records the network as the source. They are locked
on the product: the admin form disables them, `updateProduct` refuses changes
(`PROVIDER_OWNED_PRODUCT_FIELDS`), agents cannot overwrite them, and `createLink` refuses extra links.

**Unpublish** pauses the product and its tracked link (clicks fall back to the product page and are
recorded as `REDIRECT_FALLBACK`). **Archive** archives the product. Publishing again reuses the same
product and link.

### Freshness on the storefront

`products.external_data_expires_at` = fetch time + the provider's `maxDataAgeHours`. Every storefront
query (listings, product and landing pages, categories, sitemap) uses `visibleOnStorefront()`, so a
product disappears on its own when its network data is too old — even if no refresh ran. A successful
refresh moves the expiry forward. The `affiliate_refresh` job (every 2 h, listings older than 20 h,
published ones first) keeps data current where a worker runs; elsewhere n8n calls `POST /affiliate/refresh`.

### Display rules per network (`storefrontPolicy`)

| Rule | Amazon |
| --- | --- |
| Price shown with the time it was observed, followed by the network's statement | yes — "Product prices and availability are accurate as of the date/time indicated…" on product and landing pages; product cards show no Amazon price |
| Prices converted into the visitor's currency | no — shown exactly as Amazon returns them (EGP) |
| Prices in structured data (JSON-LD) | no — crawlers keep copies beyond 24 h |
| Disclosure next to the links | "As an Amazon Associate we earn from qualifying purchases." |
| Call to action | "View on Amazon.eg" |

## Tracking

| Signal | Where |
| --- | --- |
| Product views | `click_events` `PAGE_VIEW` with `product_id` (first-party beacon, bots flagged, consent-gated visitor id) |
| Outbound clicks / merchant redirects | `/r/{code}` → `AFFILIATE_CLICK` with `affiliate_product_id`, `destination_host`, UTMs, campaign/content attribution |
| Redirects that could not go to the merchant | `REDIRECT_FALLBACK` (link paused/broken, listing unpublished) |
| Source / campaign | `utm_*` on the tracked link, campaign and content resolution, A/B variant |
| Conversions and commission | `conversion_events` / `commissions` — only what a network reports, per currency, never estimated. Amazon sends no postbacks: import Associates earnings-report rows with `POST /affiliate/conversions` (MANUAL provenance, idempotent on `source + orderId`) |

The HTTP link checker skips listing links: they are verified through the network API refresh, so FORGE
never requests Amazon's pages.

## Providers

`AffiliateProvider` (`src/server/affiliate/types.ts`), registered in `src/server/affiliate/registry.ts`:

| Member | Purpose |
| --- | --- |
| `network`, `label`, `docsUrl` | Identity (network = an `AFFILIATE_NETWORK_TYPES` value) |
| `externalIdType` | What `externalId` holds (`ASIN`, `PRODUCT_ID`, …) |
| `maxDataAgeHours` | How long fetched data may be shown (`null` = no rule) |
| `marketplaces()` | Marketplaces with country, currency, languages, categories |
| `status()` | Readiness by environment variable **name** — never values |
| `storefrontPolicy(marketplace)` | The display rules above |
| `search(query)` | Official-API search → `AffiliateProductInput[]` + per-item errors |
| `getItems(marketplace, ids)` | Official-API lookup for refresh → items + errors (`NotReturned`, …) |

### Amazon Associates — Creators API

- Official API only (`https://creatorsapi.amazon/catalog/v1/searchItems` and `/getItems`). PA-API 5.0 was
  retired in May 2026.
- OAuth 2.0 client credentials; the credential version picks the flow: `2.x` Cognito (scope
  `creatorsapi/default`), `3.x` Login with Amazon (scope `creatorsapi::default`); `x.2` is the Europe /
  Middle East / India region. Tokens are cached in memory only.
- Amazon.eg: marketplace `www.amazon.eg`, EGP, languages `en_AE` / `ar_AE`, 21 search categories.
- Images are links only; review data is not requested; only tagged links Amazon returns are used.

#### Environment (server-only)

| Variable | Value |
| --- | --- |
| `AMAZON_CREATORS_CREDENTIAL_ID` | Credential ID from Associates Central (Creators API) |
| `AMAZON_CREATORS_CREDENTIAL_SECRET` | Credential secret |
| `AMAZON_CREATORS_CREDENTIAL_VERSION` | The version shown with the credentials (e.g. `2.2` or `3.2`) |
| `AMAZON_PARTNER_TAG` | Your Amazon.eg Associates tag (ends in `-21`) |
| `AMAZON_MARKETPLACE` | `www.amazon.eg` (default) |

#### Access requirements (Amazon side)

1. An Amazon Associates account **for Amazon.eg** — each marketplace needs its own account and tag.
   The Egypt programme has been invitation-only; sign-in is at `affiliate-program.amazon.eg`.
2. Creators API access: Amazon requires **at least 10 qualifying sales in the last 30 days**.
3. Credentials created in Associates Central (Creators API), with their credential version.

Until then every Amazon call returns `412 integration_not_configured` listing exactly what is missing.

## Adding a network (e.g. Alibaba / AliExpress)

The contract needs no change for a second network. A provider:

1. Adds its network value to `AFFILIATE_NETWORK_TYPES` (`src/lib/constants.ts`) and generates a migration
   (`ALTER TYPE affiliate_network_type ADD VALUE …`).
2. Lives in `src/server/affiliate/<network>/` (config, client, marketplaces, provider) and implements
   every `AffiliateProvider` member, using only the network's official API.
3. Reads credentials from new server-only variables in `src/server/env.ts` and `.env.example` (empty
   values), reports missing ones by name in `status()`, and throws `IntegrationNotConfiguredError`.
4. Normalises API items to `AffiliateProductInput`: https URLs only, image links (never copies), rating
   only with a `reviewSource`, `provenance: "REAL"`, `fetchedAt`; unknown values stay `null`.
5. Declares `maxDataAgeHours` and `storefrontPolicy` from the network's licence and programme terms.
6. Is listed in `AFFILIATE_PROVIDERS`, with unit tests against a stubbed `fetch` (see
   `tests/unit/amazon-provider.test.ts`).

Nothing else changes: ingest, review, publishing, freshness, tracking, the admin screens and the API
work for the new network as they are.

**AliExpress Affiliate API** (Alibaba Group's consumer affiliate programme on the AliExpress Open
Platform) maps onto the contract as follows — verify every field against the official documentation
when implementing:

| Contract | AliExpress |
| --- | --- |
| `search` / `getItems` | `aliexpress.affiliate.product.query` / `aliexpress.affiliate.productdetail.get` |
| `externalId`, `externalIdType` | `product_id`, `PRODUCT_ID` |
| `affiliateUrl` | `promotion_link` (its host differs from the marketplace — allowed by the contract) |
| `productUrl`, `imageUrls` | `product_detail_url`, `product_main_image_url` + `product_small_image_urls` |
| `price`, `currency` | `target_sale_price`, `target_sale_price_currency` |
| `commissionRate` | `commission_rate` (network-supplied, provider-owned) |
| `category`, `categoryPath` | first/second level category names |
| Rating | `evaluate_rate` is a positive-feedback percentage, not a 0–5 rating → `networkMeta`, not `rating` |
| Credentials | app key, app secret (request signing), tracking id |

Alibaba.com's B2B marketplace is a different programme; confirm which one is meant before building.

## API for automation (n8n)

Create an API key with the **automation** role (Settings → API keys) and send
`Authorization: Bearer forge_…`. All under `/api/v1`.

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /affiliate/providers` | affiliate:read | Readiness per network, marketplaces, categories |
| `POST /affiliate/discover` `{ network?, marketplace?, keywords, category?, limit?, page? }` | affiliate:ingest | Official-API search → DISCOVERED listings |
| `POST /affiliate/products` `{ items: [...], source?: "n8n" }` | affiliate:ingest | Send listings in (≤ 100); upsert by network + marketplace + id |
| `GET /affiliate/products?status=&network=&marketplace=&stale=&hasError=&q=&updatedSince=&sort=&limit=&offset=` | affiliate:read | Queue with `total`, `fresh`, `dataAgeHours`, `allowedActions`, `publishBlockers` |
| `GET /affiliate/products/{id}` | affiliate:read | One listing + its storefront product and tracked link |
| `PATCH /affiliate/products/{id}` `{ revision, categoryId?, summary?, problemSolved?, targetAudience?, tags?, expectedCommissionRate? }` | affiliate:ingest (before review) / review | Enrich FORGE-owned fields |
| `POST /affiliate/products/{id}/score` `{ score, provenance, source, reasons? }` | affiliate:ingest | Record a score |
| `POST /affiliate/products/{id}/transition` `{ action, note?, revision? }` | per action (table above) | submit · unpublish · archive (machines); approve · publish need a person |
| `POST /affiliate/products/{id}/failure` `{ code, message, unpublish? }` | affiliate:ingest | Report a problem; optionally take the listing down |
| `POST /affiliate/refresh` `{ network?, marketplace?, olderThanHours?, limit? }` | affiliate:ingest | Re-fetch listings older than 20 h (published first) |
| `GET /affiliate/failures?expiringWithinHours=` | affiliate:read | Refresh errors, expired / expiring storefront data, broken links, redirect fallbacks, unconfigured providers |
| `GET /affiliate/tracking?days=&network=&id=` | affiliate:read | Views, outbound clicks, fallbacks, CTR, reported conversions and commission per listing |
| `POST /affiliate/conversions` `{ source?, items: [{ network, marketplace, externalId, orderId, occurredAt, revenue, commission, currency, clickId? }] }` | affiliate:ingest | Import network-reported conversions (e.g. Amazon earnings reports) |

Failures come back as structured errors (`400 validation_error`, `403 forbidden`, `409 conflict`,
`412 integration_not_configured`, `429 amazon_throttled` with `Retry-After`, `502 amazon_api_error`).
Poll with `updatedSince` for incremental sync.

## Admin

**Catalog → Network listings** (`/admin/affiliate-products`): provider configuration and readiness,
discovery, the queue with status tabs, search and filters (fresh/stale, refresh errors), and per listing:
review actions with notes, read-only network data with provenance and freshness, FORGE fields (with
revision checks), score, storefront product and tracked link, 30-day tracking and the decision history.

## Not built yet

- The n8n workflows themselves (discovery schedule, enrichment/scoring, review notifications, earnings-report import, failure alerts).
- Push notifications from FORGE to n8n when a listing needs review (n8n polls with `updatedSince` for now).
- Guards that keep Amazon links and prices out of generated e-mail/social content (see compliance notes in the final report).
