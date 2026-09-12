// Job type → handler. Handlers run in the worker (never inside an HTTP request).

import type { JobType } from "@/lib/constants";
import type { ServiceContext } from "../context";
import { analyticsAgent, contentAgent, landingPageAgent, optimizationAgent, reportingAgent, researchAgent, scoringAgent, trendAgent } from "../agents/agents";
import { orchestrator } from "../agents/orchestrator";
import { runAgent } from "../agents/runtime";
import { checkAllLinks } from "../services/affiliate";
import { dispatchNotification } from "../services/notifications";
import { refreshRecommendations } from "../services/recommendations";
import { evaluateAllTests } from "../services/testing";
import { syncShopifyOrders } from "../integrations/shopify";

type Payload = Record<string, unknown>;
type Handler = (ctx: ServiceContext, payload: Payload) => Promise<unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

export const JOB_HANDLERS: Record<JobType, Handler> = {
  product_discovery: (ctx, p) => runAgent(ctx, orchestrator, { pipeline: "discover", keywords: Array.isArray(p.keywords) ? (p.keywords as string[]) : undefined }).then((r) => r.output),
  product_research: (ctx, p) => runAgent(ctx, researchAgent, p.productId ? { productId: String(p.productId) } : (p as never), { productId: str(p.productId) }).then((r) => r.output),
  product_scoring: (ctx, p) => runAgent(ctx, scoringAgent, { productId: str(p.productId) }).then((r) => r.output),
  trend_refresh: (ctx) => runAgent(ctx, trendAgent, {}).then((r) => r.output),
  affiliate_link_check: (ctx) => checkAllLinks(ctx),
  content_generation: (ctx, p) =>
    runAgent(ctx, contentAgent, { productId: String(p.productId), batch: str(p.batch) as never, platform: str(p.platform) as never, contentType: str(p.contentType) as never, count: num(p.count), angle: str(p.angle) as never, schedule: p.schedule === true }, { productId: str(p.productId) }).then((r) => r.output),
  landing_page_generation: (ctx, p) => runAgent(ctx, landingPageAgent, { productId: String(p.productId), template: str(p.template) as never }, { productId: str(p.productId) }).then((r) => r.output),
  analytics_sync: (ctx) => runAgent(ctx, analyticsAgent, {}).then((r) => r.output),
  shopify_sync: (ctx) => syncShopifyOrders(ctx),
  report_generation: (ctx, p) => runAgent(ctx, reportingAgent, { type: p.type === "TOP5_WEEKLY" ? "TOP5_WEEKLY" : "TOP5_DAILY" }).then((r) => r.output),
  notification_dispatch: (ctx, p) => dispatchNotification(ctx, String(p.notificationId)),
  recommendations_refresh: (ctx) => runAgent(ctx, optimizationAgent, {}).then((r) => r.output),
  test_evaluation: (ctx) => evaluateAllTests(ctx).then(async (r) => ({ ...r, recommendations: await refreshRecommendations(ctx) })),
  launch_test_kit: (ctx, p) => runAgent(ctx, orchestrator, { pipeline: "launch_test_kit", productId: String(p.productId), contentBatch: p.batch === "full" ? "full" : "launch" }, { productId: str(p.productId) }).then((r) => r.output),
  first_run: (ctx, p) => runAgent(ctx, orchestrator, { pipeline: "first_run", launchTop: num(p.launchTop) }).then((r) => r.output),
};

export const JOB_LABELS: Record<JobType, string> = {
  product_discovery: "Discover products",
  product_research: "Research product",
  product_scoring: "Update product scores",
  trend_refresh: "Refresh trend signals",
  affiliate_link_check: "Check affiliate links",
  content_generation: "Generate content",
  landing_page_generation: "Generate landing page",
  analytics_sync: "Sync analytics",
  shopify_sync: "Sync Shopify",
  report_generation: "Generate Top 5 report",
  notification_dispatch: "Send notification",
  recommendations_refresh: "Refresh recommendations",
  test_evaluation: "Evaluate product tests",
  launch_test_kit: "Launch test kit",
  first_run: "First-run discovery workflow",
};
