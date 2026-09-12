# Automations & jobs

Long work never runs inside an HTTP request. Requests enqueue jobs; workers execute them.

## Queue

`jobs` table on PostgreSQL. Workers claim with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`,
so any number of workers can run concurrently. Failed jobs retry with exponential backoff
(30 s → 1 h, `max_attempts` default 3); jobs whose worker died are re-queued after the lock
timeout; identical jobs are de-duplicated by `dedupe_key` while queued/running. Every execution
writes an `automation_runs` row (status, duration, summary/error).

Runners: `JOB_RUNNER=embedded` (inside the web process — dev, single-node) or `external`
(`npm run worker` / `node dist/worker.cjs`, one or more replicas).

## Schedules (cron, UTC — editable in Logs → Automations)

| Key | Job | Cron |
|---|---|---|
| daily_link_check | affiliate_link_check — alerts on broken links; pauses products whose merchant page is gone | `30 4 * * *` |
| daily_trend_refresh | trend_refresh — Wikimedia interest signals → re-score | `0 5 * * *` |
| daily_discovery | product_discovery — all enabled sources | `0 6 * * *` |
| daily_scoring | product_scoring — all active products | `30 6 * * *` |
| daily_recommendations | recommendations_refresh — Optimization agent | `0 7 * * *` |
| daily_top5 | report_generation (TOP5_DAILY) | `0 8 * * *` |
| weekly_top5 | report_generation (TOP5_WEEKLY) | `0 8 * * 1` |
| daily_test_evaluation | test_evaluation — verdicts & decisions | `0 9 * * *` |
| hourly_analytics | analytics_sync — rollups + spike detection | `15 * * * *` |
| shopify_sync | shopify_sync — orders (when connected, not in demo) | `0 */6 * * *` |

## Event-driven automations

| Trigger | Action |
|---|---|
| Product becomes WINNER (test evaluation) | Notification + `content_generation` job (scale batch on the winning angle) |
| Test evaluation decides KILL | "Product should be killed" notification + recommendation (operator confirms) |
| Affiliate link check fails | LINK_BROKEN alert; `/r/` sends visitors to the product page instead |
| Merchant page 404/410, or Shopify reports out-of-stock/archived/deleted | Product marked unavailable → PAUSED → INVENTORY_UNAVAILABLE alert |
| Discovery finds a product above the opportunity threshold | NEW_OPPORTUNITY notification |
| Traffic or conversions ≥ N× trailing daily average | TRAFFIC_SPIKE / CONVERSION_SPIKE notification |
| Week-over-week traffic drop ≥ 40% on a live product | PERFORMANCE_DROP recommendation ("generate fresh hooks") |
| Report generated | REPORT_READY notification |
| Any notification with email/Telegram enabled | `notification_dispatch` job (suppressed in DEMO_MODE) |

## Job types

`product_discovery`, `product_research`, `product_scoring`, `trend_refresh`, `affiliate_link_check`,
`content_generation`, `landing_page_generation`, `analytics_sync`, `shopify_sync`, `report_generation`,
`notification_dispatch`, `recommendations_refresh`, `test_evaluation`, `launch_test_kit`, `first_run`.

Queue any of them from the UI, `POST /api/v1/jobs`, or the command center.
