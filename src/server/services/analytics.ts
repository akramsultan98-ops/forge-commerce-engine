// Analytics & attribution. All aggregates exclude bot traffic; demo rows are included only in DEMO_MODE.

import { sql } from "drizzle-orm";
import type { ServiceContext } from "../context";
import { productMetrics } from "../db/schema";
import { isDemoMode } from "../env";
import { isoDate, safeDivide } from "@/lib/utils";
import { EXCLUDED_ORDER_STATUSES } from "../integrations/shopify-orders";

export interface DateRange {
  from: Date;
  to: Date;
}

export function rangeForDays(days: number, now = new Date()): DateRange {
  const to = new Date(now);
  const from = new Date(now.getTime() - days * 86400_000);
  return { from, to };
}

type Row = Record<string, unknown>;
const rows = (r: { rows: unknown[] }) => r.rows as Row[];
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const demoCond = (alias: string) => (isDemoMode() ? sql`true` : sql.raw(`${alias}.is_demo = false`));
/** Orders that are money: refunded, cancelled, pending and voided lines are excluded everywhere. */
const paidOrder = (alias: string) => sql.raw(`${alias}.status not in (${EXCLUDED_ORDER_STATUSES.map((s) => `'${s}'`).join(",")})`);
/** Orders are stored one row per line item — count distinct orders, not rows. */
const orderCount = (alias: string) => sql.raw(`count(distinct coalesce(${alias}.external_order_id, ${alias}.id::text))::int`);

export interface Kpis {
  pageViews: number;
  visitors: number;
  productClicks: number;
  affiliateClicks: number;
  clicks: number;
  conversions: number;
  affiliateSales: number;
  commission: number;
  orders: number;
  orderRevenue: number;
  orderCost: number;
  revenue: number;
  spend: number;
  aiCost: number;
  profit: number;
  conversionRate: number;
  ctr: number;
}

export async function kpis(ctx: Pick<ServiceContext, "db" | "orgId">, range: DateRange): Promise<Kpis> {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const [ev] = rows(
    await ctx.db.execute(sql`
      select count(*) filter (where event_type = 'PAGE_VIEW')::int as page_views,
             count(distinct visitor_id)::int as visitors,
             count(*) filter (where event_type = 'PRODUCT_CLICK')::int as product_clicks,
             count(*) filter (where event_type = 'AFFILIATE_CLICK')::int as affiliate_clicks
      from click_events e
      where e.organization_id = ${ctx.orgId} and e.created_at >= ${from}::timestamptz and e.created_at < ${to}::timestamptz and e.is_bot = false and ${demoCond("e")}`),
  );
  const [cv] = rows(
    await ctx.db.execute(sql`
      select count(*)::int as conversions, coalesce(sum(revenue), 0)::float8 as sales, coalesce(sum(commission), 0)::float8 as commission
      from conversion_events c
      where c.organization_id = ${ctx.orgId} and c.occurred_at >= ${from}::timestamptz and c.occurred_at < ${to}::timestamptz and ${demoCond("c")}`),
  );
  const [od] = rows(
    await ctx.db.execute(sql`
      select ${orderCount("o")} as orders, coalesce(sum(revenue), 0)::float8 as revenue, coalesce(sum(cost + shipping_cost), 0)::float8 as cost
      from orders o
      where o.organization_id = ${ctx.orgId} and o.occurred_at >= ${from}::timestamptz and o.occurred_at < ${to}::timestamptz and ${paidOrder("o")} and ${demoCond("o")}`),
  );
  const [sp] = rows(
    await ctx.db.execute(sql`
      select coalesce(sum(spend), 0)::float8 as spend from campaigns c
      where c.organization_id = ${ctx.orgId} and coalesce(c.start_at, c.created_at) < ${to}::timestamptz and ${demoCond("c")}`),
  );
  const [ai] = rows(
    await ctx.db.execute(sql`
      select coalesce(sum(estimated_cost_usd), 0)::float8 as cost from ai_usage
      where organization_id = ${ctx.orgId} and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz`),
  );
  const pageViews = n(ev?.page_views);
  const productClicks = n(ev?.product_clicks);
  const affiliateClicks = n(ev?.affiliate_clicks);
  const commission = n(cv?.commission);
  const orderRevenue = n(od?.revenue);
  const orderCost = n(od?.cost);
  const spend = n(sp?.spend);
  const aiCost = n(ai?.cost);
  const conversions = n(cv?.conversions);
  const orders = n(od?.orders);
  return {
    pageViews,
    visitors: n(ev?.visitors),
    productClicks,
    affiliateClicks,
    clicks: productClicks + affiliateClicks,
    conversions,
    affiliateSales: n(cv?.sales),
    commission,
    orders: orders + conversions,
    orderRevenue,
    orderCost,
    // What the business earns: owned-inventory revenue + affiliate commission.
    revenue: orderRevenue + commission,
    spend,
    aiCost,
    profit: commission + (orderRevenue - orderCost) - spend - aiCost,
    conversionRate: safeDivide(orders + conversions, pageViews),
    ctr: safeDivide(affiliateClicks + productClicks, pageViews),
  };
}

export async function timeseries(ctx: Pick<ServiceContext, "db" | "orgId">, range: DateRange, productId?: string) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const pf = (alias: string) => (productId ? sql`and ${sql.raw(alias)}.product_id = ${productId}` : sql``);
  const ev = rows(
    await ctx.db.execute(sql`
      select to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD') as d,
             count(*) filter (where event_type = 'PAGE_VIEW')::int as views,
             count(*) filter (where event_type in ('AFFILIATE_CLICK','PRODUCT_CLICK'))::int as clicks
      from click_events e
      where e.organization_id = ${ctx.orgId} and e.created_at >= ${from}::timestamptz and e.created_at < ${to}::timestamptz and e.is_bot = false and ${demoCond("e")} ${pf("e")}
      group by 1`),
  );
  const cv = rows(
    await ctx.db.execute(sql`
      select to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as d, count(*)::int as conversions, coalesce(sum(commission), 0)::float8 as commission
      from conversion_events c where c.organization_id = ${ctx.orgId} and c.occurred_at >= ${from}::timestamptz and c.occurred_at < ${to}::timestamptz and ${demoCond("c")} ${pf("c")} group by 1`),
  );
  const od = rows(
    await ctx.db.execute(sql`
      select to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as d, ${orderCount("o")} as orders, coalesce(sum(revenue), 0)::float8 as revenue
      from orders o where o.organization_id = ${ctx.orgId} and o.occurred_at >= ${from}::timestamptz and o.occurred_at < ${to}::timestamptz and ${paidOrder("o")} and ${demoCond("o")} ${pf("o")} group by 1`),
  );
  const byDay = new Map<string, { date: string; views: number; clicks: number; conversions: number; revenue: number }>();
  for (let t = new Date(Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate())); t < range.to; t = new Date(t.getTime() + 86400_000)) {
    byDay.set(isoDate(t), { date: isoDate(t), views: 0, clicks: 0, conversions: 0, revenue: 0 });
  }
  for (const r of ev) {
    const d = byDay.get(String(r.d));
    if (d) {
      d.views = n(r.views);
      d.clicks = n(r.clicks);
    }
  }
  for (const r of cv) {
    const d = byDay.get(String(r.d));
    if (d) {
      d.conversions += n(r.conversions);
      d.revenue += n(r.commission);
    }
  }
  for (const r of od) {
    const d = byDay.get(String(r.d));
    if (d) {
      d.conversions += n(r.orders);
      d.revenue += n(r.revenue);
    }
  }
  return [...byDay.values()];
}

export type Dimension = "platform" | "content" | "country" | "source" | "campaign";

export async function breakdown(ctx: Pick<ServiceContext, "db" | "orgId">, range: DateRange, dimension: Dimension, limit = 8) {
  const col = { platform: "utm_source", content: "utm_content", country: "country", source: "coalesce(utm_source, case when referrer is null or referrer = '' then 'direct' else split_part(split_part(referrer, '://', 2), '/', 1) end)", campaign: "utm_campaign" }[dimension];
  const res = rows(
    await ctx.db.execute(sql`
      select ${sql.raw(col)} as key,
             count(*) filter (where event_type = 'PAGE_VIEW')::int as views,
             count(*) filter (where event_type in ('AFFILIATE_CLICK','PRODUCT_CLICK'))::int as clicks
      from click_events e
      where e.organization_id = ${ctx.orgId} and e.created_at >= ${range.from.toISOString()}::timestamptz and e.created_at < ${range.to.toISOString()}::timestamptz
        and e.is_bot = false and ${demoCond("e")} and ${sql.raw(col)} is not null
      group by 1 order by clicks desc, views desc limit ${limit}`),
  );
  const conv = rows(
    await ctx.db.execute(sql`
      select ${sql.raw(dimension === "source" ? "utm_source" : dimension === "platform" ? "utm_source" : dimension === "content" ? "utm_content" : dimension === "campaign" ? "utm_campaign" : "country")} as key,
             count(*)::int as conversions, coalesce(sum(commission), 0)::float8 as commission
      from conversion_events c
      where c.organization_id = ${ctx.orgId} and c.occurred_at >= ${range.from.toISOString()}::timestamptz and c.occurred_at < ${range.to.toISOString()}::timestamptz and ${demoCond("c")}
      group by 1`),
  );
  const convMap = new Map(conv.map((r) => [String(r.key), { conversions: n(r.conversions), commission: n(r.commission) }]));
  return res.map((r) => ({ key: String(r.key), views: n(r.views), clicks: n(r.clicks), conversions: convMap.get(String(r.key))?.conversions ?? 0, commission: convMap.get(String(r.key))?.commission ?? 0 }));
}

export interface LeaderboardRow {
  productId: string;
  title: string;
  slug: string;
  status: string;
  score: number | null;
  businessModel: string;
  isDemo: boolean;
  views: number;
  productClicks: number;
  affiliateClicks: number;
  conversions: number;
  orders: number;
  revenue: number;
  commission: number;
  conversionRate: number;
  ctr: number;
}

export async function leaderboard(ctx: Pick<ServiceContext, "db" | "orgId">, range: DateRange, limit = 20): Promise<LeaderboardRow[]> {
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const res = rows(
    await ctx.db.execute(sql`
      select p.id, p.title, p.slug, p.status, p.overall_score as score, p.business_model as "businessModel", p.is_demo as "isDemo",
             coalesce(e.views, 0)::int as views, coalesce(e.pclicks, 0)::int as "productClicks", coalesce(e.aclicks, 0)::int as "affiliateClicks",
             coalesce(c.n, 0)::int as conversions, coalesce(c.commission, 0)::float8 as commission,
             coalesce(o.n, 0)::int as orders, coalesce(o.revenue, 0)::float8 as revenue
      from products p
      left join (
        select product_id, count(*) filter (where event_type = 'PAGE_VIEW') as views,
               count(*) filter (where event_type = 'PRODUCT_CLICK') as pclicks,
               count(*) filter (where event_type = 'AFFILIATE_CLICK') as aclicks
        from click_events where organization_id = ${ctx.orgId} and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz and is_bot = false
        group by product_id
      ) e on e.product_id = p.id
      left join (
        select product_id, count(*) as n, sum(commission) as commission from conversion_events
        where organization_id = ${ctx.orgId} and occurred_at >= ${from}::timestamptz and occurred_at < ${to}::timestamptz group by product_id
      ) c on c.product_id = p.id
      left join (
        select o.product_id, ${orderCount("o")} as n, sum(o.revenue) as revenue from orders o
        where o.organization_id = ${ctx.orgId} and o.occurred_at >= ${from}::timestamptz and o.occurred_at < ${to}::timestamptz and ${paidOrder("o")} group by o.product_id
      ) o on o.product_id = p.id
      where p.organization_id = ${ctx.orgId} and ${demoCond("p")}
      order by (coalesce(c.commission, 0) + coalesce(o.revenue, 0)) desc, coalesce(e.aclicks, 0) desc, p.overall_score desc nulls last
      limit ${limit}`),
  );
  return res.map((r) => {
    const views = n(r.views);
    const conversions = n(r.conversions) + n(r.orders);
    return {
      productId: String(r.id),
      title: String(r.title),
      slug: String(r.slug),
      status: String(r.status),
      score: r.score === null ? null : n(r.score),
      businessModel: String(r.businessModel),
      isDemo: Boolean(r.isDemo),
      views,
      productClicks: n(r.productClicks),
      affiliateClicks: n(r.affiliateClicks),
      conversions: n(r.conversions),
      orders: n(r.orders),
      revenue: n(r.revenue) + n(r.commission),
      commission: n(r.commission),
      conversionRate: safeDivide(conversions, views),
      ctr: safeDivide(n(r.affiliateClicks) + n(r.productClicks), views),
    };
  });
}

/** Funnel by source/campaign/content: visit → product click → affiliate click → purchase → money. */
export async function attributionFunnel(ctx: Pick<ServiceContext, "db" | "orgId">, range: DateRange, groupBy: "utm_source" | "utm_campaign" | "utm_content" = "utm_source") {
  const res = rows(
    await ctx.db.execute(sql`
      with ev as (
        select coalesce(${sql.raw(groupBy)}, '(direct)') as key,
               count(*) filter (where event_type = 'PAGE_VIEW')::int as visits,
               count(*) filter (where event_type = 'PRODUCT_CLICK')::int as product_clicks,
               count(*) filter (where event_type = 'AFFILIATE_CLICK')::int as affiliate_clicks,
               count(*) filter (where event_type = 'CHECKOUT')::int as checkouts
        from click_events e
        where e.organization_id = ${ctx.orgId} and e.created_at >= ${range.from.toISOString()}::timestamptz and e.created_at < ${range.to.toISOString()}::timestamptz and e.is_bot = false and ${demoCond("e")}
        group by 1
      ), cv as (
        select coalesce(${sql.raw(groupBy)}, '(direct)') as key, count(*)::int as purchases, coalesce(sum(revenue), 0)::float8 as sales, coalesce(sum(commission), 0)::float8 as commission
        from conversion_events c
        where c.organization_id = ${ctx.orgId} and c.occurred_at >= ${range.from.toISOString()}::timestamptz and c.occurred_at < ${range.to.toISOString()}::timestamptz and ${demoCond("c")}
        group by 1
      ), od as (
        select coalesce(${sql.raw(groupBy)}, '(direct)') as key, ${orderCount("o")} as orders, coalesce(sum(revenue), 0)::float8 as revenue
        from orders o
        where o.organization_id = ${ctx.orgId} and o.occurred_at >= ${range.from.toISOString()}::timestamptz and o.occurred_at < ${range.to.toISOString()}::timestamptz and ${paidOrder("o")} and ${demoCond("o")}
        group by 1
      )
      select coalesce(ev.key, cv.key, od.key) as key, coalesce(ev.visits, 0) as visits, coalesce(ev.product_clicks, 0) as "productClicks",
             coalesce(ev.affiliate_clicks, 0) as "affiliateClicks", coalesce(ev.checkouts, 0) as checkouts,
             coalesce(cv.purchases, 0) + coalesce(od.orders, 0) as purchases, coalesce(cv.sales, 0) + coalesce(od.revenue, 0) as sales, coalesce(cv.commission, 0) as commission
      from ev full outer join cv on cv.key = ev.key full outer join od on od.key = coalesce(ev.key, cv.key)
      order by visits desc, purchases desc limit 25`),
  );
  return res.map((r) => ({
    key: String(r.key),
    visits: n(r.visits),
    productClicks: n(r.productClicks),
    affiliateClicks: n(r.affiliateClicks),
    checkouts: n(r.checkouts),
    purchases: n(r.purchases),
    sales: n(r.sales),
    commission: n(r.commission),
  }));
}

export interface ProductStats {
  pageViews: number;
  productClicks: number;
  affiliateClicks: number;
  conversions: number;
  revenue: number;
  commission: number;
  cost: number;
  contentViews: number;
  contentEngagements: number;
}

export async function productStats(ctx: Pick<ServiceContext, "db" | "orgId">, productId: string, since: Date): Promise<ProductStats> {
  const s = since.toISOString();
  const [e] = rows(
    await ctx.db.execute(sql`
      select count(*) filter (where event_type = 'PAGE_VIEW')::int as views,
             count(*) filter (where event_type = 'PRODUCT_CLICK')::int as pclicks,
             count(*) filter (where event_type = 'AFFILIATE_CLICK')::int as aclicks
      from click_events where product_id = ${productId} and created_at >= ${s}::timestamptz and is_bot = false`),
  );
  const [c] = rows(await ctx.db.execute(sql`select count(*)::int as n, coalesce(sum(commission), 0)::float8 as commission from conversion_events where product_id = ${productId} and occurred_at >= ${s}::timestamptz`));
  const [o] = rows(
    await ctx.db.execute(sql`select ${orderCount("o")} as n, coalesce(sum(o.revenue), 0)::float8 as revenue, coalesce(sum(o.cost + o.shipping_cost), 0)::float8 as cost from orders o where o.product_id = ${productId} and o.occurred_at >= ${s}::timestamptz and ${paidOrder("o")}`),
  );
  const [sp] = rows(await ctx.db.execute(sql`select coalesce(sum(spend), 0)::float8 as spend from campaigns where product_id = ${productId}`));
  const [m] = rows(
    await ctx.db.execute(sql`
      select coalesce(sum(cm.views), 0)::int as views, coalesce(sum(cm.likes + cm.comments + cm.shares + cm.saves), 0)::int as eng
      from content_metrics cm join content ct on ct.id = cm.content_id where ct.product_id = ${productId} and cm.date >= ${isoDate(since)}`),
  );
  return {
    pageViews: n(e?.views),
    productClicks: n(e?.pclicks),
    affiliateClicks: n(e?.aclicks),
    conversions: n(c?.n) + n(o?.n),
    revenue: n(o?.revenue),
    commission: n(c?.commission),
    cost: n(o?.cost) + n(sp?.spend),
    contentViews: n(m?.views),
    contentEngagements: n(m?.eng),
  };
}

/** Rebuilds daily product_metrics rollups for the last `days` days (analytics_sync job). */
export async function syncProductMetrics(ctx: Pick<ServiceContext, "db" | "orgId">, days = 2) {
  const since = new Date(Date.now() - days * 86400_000);
  const s = since.toISOString();
  const res = rows(
    await ctx.db.execute(sql`
      select p.id as product_id, d.day,
        (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'PAGE_VIEW' and e.is_bot = false and date_trunc('day', e.created_at at time zone 'UTC') = d.day)::int as views,
        (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'PRODUCT_CLICK' and e.is_bot = false and date_trunc('day', e.created_at at time zone 'UTC') = d.day)::int as pclicks,
        (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'AFFILIATE_CLICK' and e.is_bot = false and date_trunc('day', e.created_at at time zone 'UTC') = d.day)::int as aclicks,
        (select count(*) from conversion_events c where c.product_id = p.id and date_trunc('day', c.occurred_at at time zone 'UTC') = d.day)::int as conversions,
        (select coalesce(sum(commission), 0) from conversion_events c where c.product_id = p.id and date_trunc('day', c.occurred_at at time zone 'UTC') = d.day)::float8 as commission,
        (select ${orderCount("o")} from orders o where o.product_id = p.id and ${paidOrder("o")} and date_trunc('day', o.occurred_at at time zone 'UTC') = d.day) as orders,
        (select coalesce(sum(revenue), 0) from orders o where o.product_id = p.id and ${paidOrder("o")} and date_trunc('day', o.occurred_at at time zone 'UTC') = d.day)::float8 as revenue,
        (select coalesce(sum(cost + shipping_cost), 0) from orders o where o.product_id = p.id and ${paidOrder("o")} and date_trunc('day', o.occurred_at at time zone 'UTC') = d.day)::float8 as cost
      from products p
      cross join (select generate_series(date_trunc('day', ${s}::timestamptz at time zone 'UTC'), date_trunc('day', now() at time zone 'UTC'), interval '1 day') as day) d
      where p.organization_id = ${ctx.orgId}`),
  );
  let upserted = 0;
  for (const r of res) {
    if (!n(r.views) && !n(r.pclicks) && !n(r.aclicks) && !n(r.conversions) && !n(r.orders)) continue;
    const date = new Date(String(r.day)).toISOString().slice(0, 10);
    const values = {
      pageViews: n(r.views),
      productClicks: n(r.pclicks),
      affiliateClicks: n(r.aclicks),
      conversions: n(r.conversions),
      orders: n(r.orders),
      revenue: n(r.revenue),
      commission: n(r.commission),
      cost: n(r.cost),
    };
    await ctx.db
      .insert(productMetrics)
      .values({ productId: String(r.product_id), date, ...values })
      .onConflictDoUpdate({ target: [productMetrics.productId, productMetrics.date], set: values });
    upserted++;
  }
  return { upserted };
}

/** Spike detection: last 24h vs the trailing 7-day daily average, per product. */
export async function detectSpikes(ctx: Pick<ServiceContext, "db" | "orgId">, multiplier: number) {
  const res = rows(
    await ctx.db.execute(sql`
      select p.id, p.title,
        (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'PAGE_VIEW' and e.is_bot = false and e.created_at >= now() - interval '1 day')::int as views_24h,
        (select count(*) from click_events e where e.product_id = p.id and e.event_type = 'PAGE_VIEW' and e.is_bot = false and e.created_at >= now() - interval '8 days' and e.created_at < now() - interval '1 day')::float8 / 7 as views_avg,
        (select count(*) from conversion_events c where c.product_id = p.id and c.occurred_at >= now() - interval '1 day')::int as conv_24h,
        (select count(*) from conversion_events c where c.product_id = p.id and c.occurred_at >= now() - interval '8 days' and c.occurred_at < now() - interval '1 day')::float8 / 7 as conv_avg
      from products p where p.organization_id = ${ctx.orgId} and p.status in ('TESTING','WINNER','SCALING','APPROVED')`),
  );
  const spikes: Array<{ productId: string; title: string; kind: "TRAFFIC_SPIKE" | "CONVERSION_SPIKE"; current: number; baseline: number }> = [];
  for (const r of res) {
    if (n(r.views_24h) >= 50 && n(r.views_24h) >= multiplier * Math.max(n(r.views_avg), 1)) spikes.push({ productId: String(r.id), title: String(r.title), kind: "TRAFFIC_SPIKE", current: n(r.views_24h), baseline: n(r.views_avg) });
    if (n(r.conv_24h) >= 5 && n(r.conv_24h) >= multiplier * Math.max(n(r.conv_avg), 0.5)) spikes.push({ productId: String(r.id), title: String(r.title), kind: "CONVERSION_SPIKE", current: n(r.conv_24h), baseline: n(r.conv_avg) });
  }
  return spikes;
}
