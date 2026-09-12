# Product discovery, scoring & research

## Principles

1. **Never fabricate** sales numbers, reviews or trends. If a signal is missing it is shown as missing.
2. **Official APIs and feeds only.** No scraping that violates platform terms.
3. **Provenance everywhere** — REAL, ESTIMATED, AI_INFERENCE, MANUAL, DEMO.

## Source adapters (`src/server/discovery/adapters.ts`)

```ts
interface SourceAdapter {
  key; label; kind: "supplier" | "affiliate" | "marketplace" | "trend" | "manual" | "demo";
  officialApi; docsUrl; requirements: string[]; implementation: "implemented" | "interface";
  isConfigured(creds, config); discover?(query, creds, config); signals?(keyword, creds);
}
```

| Adapter | Status | Needs |
|---|---|---|
| Manual CSV import | implemented | a CSV (UI or `POST /api/v1/products/import`) |
| Affiliate product feed (Awin, ShareASale, Impact exports, any CSV URL) | implemented | the network's official feed URL |
| CJdropshipping API v2 | implemented (verify mapping with your account) | `CJ_API_KEY` |
| Shopify-compatible supplier catalog | implemented | connected Shopify store synced by a supplier app |
| Wikimedia pageviews (trend signal) | implemented, no key | a Wikipedia article title per product (`trend keyword`) |
| AliExpress Open Platform | interface | approved app key/secret |
| Amazon Associates — Creators API | implemented as an affiliate provider ([AFFILIATE_PRODUCTS.md](AFFILIATE_PRODUCTS.md)) | Amazon.eg Associates account with Creators API access (≥ 10 qualifying sales / 30 days) |
| TikTok Shop Partner API | interface | approved partner app |
| DSers-compatible | interface | no public discovery API — use AliExpress + DSers fulfilment |
| Social trend signals (Pinterest Trends / TikTok Research) | interface | approved access |
| Demo feed | implemented, DEMO_MODE only | — |

"Interface" adapters have the contract, DB model, UI and setup state; their `discover()` raises
`IntegrationNotConfiguredError` listing exactly what to obtain. Implement the call once access is approved.

### CSV columns

`title` (required), `description`, `category`, `brand`, `supplier`, `supplier_url`, `product_url`/`url`,
`affiliate_url`, `image_url`, `sku`/`source_product_id`, `currency`, `cost`, `price`/`selling_price`,
`shipping_cost`, `shipping_days`/`shipping_days_max`, `shipping_days_min`, `commission`/`commission_percentage`,
`affiliate_commission`, `rating`, `reviews`, `estimated_sales`, `countries` (`US|GB`), `tags`, `trend_keyword`,
`business_model`. Imported values are MANUAL provenance; re-importing the same `sku` updates the product.

## Trend signal (Wikimedia)

90 days of daily article pageviews → recent 28-day average vs the prior period →
`trend = 0.7 × growth score + 0.3 × volume score` (`src/domain/trends.ts`). Stored as REAL
`product_signals` with source attribution. It measures public interest, not sales — the UI says so.

## Scoring engine (`src/domain/scoring.ts`)

| Factor | Default weight | Inputs |
|---|---|---|
| Trend potential | 15 | trend index, else review growth |
| Sales velocity | 15 | estimated monthly sales / daily velocity / review growth proxy |
| Margin potential | 15 | dropshipping: gross margin & unit profit; affiliate: commission % and amount |
| Content potential | 15 | visual demonstration potential |
| Problem–solution strength | 10 | how obvious/painful the problem is |
| Impulse-buy potential | 10 | price band (USD-normalised) + impulse appeal |
| Competition opportunity | 10 | inverse competition / seller count, ad saturation |
| Novelty | 5 | |
| Shipping feasibility | 5 | delivery days, shipping-cost ratio, availability in the primary market |

- Weights are configurable (Settings → Scoring) and normalised.
- Missing inputs are held at **50** and reduce **confidence** (weighted input quality: REAL 1.0, MANUAL 0.85,
  ESTIMATED 0.65, AI 0.5, DEMO 0.35, missing 0).
- **Reasons** (factors ≥ 75) and **warnings** (≤ 40, moderate competition, ad saturation, low rating,
  thin unit profit, missing data, demo data) explain every score.
- **Risk flags** (section 54): medical/health claims, ingestibles, weapons, counterfeit/IP → HIGH;
  children's, electrical/battery, cosmetics, liquids → MEDIUM. HIGH-risk products are excluded from
  opportunities/reports by default and the research template refuses to recommend them.

## Research agent

Per product: verdict (TEST / WATCH / DO NOT TEST), *TEST THIS PRODUCT BECAUSE…* and
*DO NOT TEST THIS PRODUCT BECAUSE…*, why it's trending (evidence-only), demand, competition, pricing,
supplier & shipping notes, social/content potential, target customer, marketing angles, 5 hooks, 3 CTAs,
landing angle, risks, recommended action, source evidence. Portfolio mode ranks the catalog against
market, budget, business model, desired margin and audience (researching only the top 3 fresh — cost control).

## Top 5 report

Daily/weekly. For each product: why trending, demand, competition, supplier cost, suggested price,
margin, commission, content opportunity, target customer, marketing angle, TikTok hook, landing angle,
risk, score, source evidence, recommended action, plus the provenance mix. No sales figure appears
unless it came from real data.

## First run

Admin → Discover → *Run first-run workflow* (or `npm run forge:first-run`). Without connected live
sources the output is explicitly labelled **DEMO DATA — no live sources connected**.
