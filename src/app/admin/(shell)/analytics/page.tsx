import Link from "next/link";
import { cn, formatCompact, formatNumber, formatPercent } from "@/lib/utils";
import { convert, formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { getSetting } from "@/server/settings";
import { isDemoMode } from "@/server/env";
import { attributionFunnel, breakdown, kpis, leaderboard, rangeForDays, timeseries } from "@/server/services/analytics";
import { DemoTag, PageHeader, Panel, StatusBadge, Table, Td, Th } from "@/components/admin/ui";
import { BarList, Funnel, StatTile } from "@/components/charts/marks";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";

export const metadata = { title: "Analytics" };

const RANGES = [7, 14, 30, 90];
const GROUPS = { utm_source: "Source", utm_campaign: "Campaign", utm_content: "Content" } as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; by?: string }> }) {
  const ctx = await pageContext("analytics:read");
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 30;
  const by = (Object.keys(GROUPS) as Array<keyof typeof GROUPS>).includes(sp.by as keyof typeof GROUPS) ? (sp.by as keyof typeof GROUPS) : "utm_source";
  const range = rangeForDays(days);
  const prev = { from: new Date(range.from.getTime() - days * 86400_000), to: range.from };
  const currency = await getSetting(ctx, "currency");
  const cur = currency.display;
  const money = (v: number, compact = false) => formatMoney(convert(v, "USD", cur, currency.rates), cur, "en", { compact });
  const [k, kp, ts, platforms, countries, sources, campaigns, contents, board, funnel] = await Promise.all([
    kpis(ctx, range),
    kpis(ctx, prev),
    timeseries(ctx, range),
    breakdown(ctx, range, "platform", 8),
    breakdown(ctx, range, "country", 8),
    breakdown(ctx, range, "source", 8),
    breakdown(ctx, range, "campaign", 8),
    breakdown(ctx, range, "content", 8),
    leaderboard(ctx, range, 50),
    attributionFunnel(ctx, range, by),
  ]);
  const d = (a: number, b: number) => (b ? (a - b) / b : null);
  const toRows = (list: typeof platforms) =>
    list.map((r) => ({ key: r.key, label: r.key, value: r.clicks, display: formatNumber(r.clicks), detail: `${formatNumber(r.views)} views · ${formatNumber(r.clicks)} clicks · ${formatNumber(r.conversions)} conv. · ${money(r.commission)} commission` }));
  const totals = funnel.reduce((acc, r) => ({ visits: acc.visits + r.visits, product: acc.product + r.productClicks, aff: acc.aff + r.affiliateClicks, purchases: acc.purchases + r.purchases }), { visits: 0, product: 0, aff: 0, purchases: 0 });
  const q = (patch: Record<string, string>) => `/admin/analytics?${new URLSearchParams({ range: String(days), by, ...patch })}`;

  return (
    <>
      <PageHeader
        eyebrow="Money & data"
        title={<span className="flex items-center gap-3">Analytics & attribution {isDemoMode() && <DemoTag />}</span>}
        description="First-party tracking only: page views, product and affiliate clicks, checkouts, conversions and orders — bots excluded, IPs hashed, visitor ids only with consent."
        actions={
          <nav aria-label="Date range" className="inline-flex rounded-md border border-edge bg-panel p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={q({ range: String(r) })} aria-current={r === days ? "true" : undefined} className={cn("rounded px-3 py-1 text-xs", r === days ? "bg-panel-3 text-fog" : "text-dim hover:text-haze")}>
                {r}d
              </Link>
            ))}
          </nav>
        }
      />
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Revenue" value={money(k.revenue, true)} delta={d(k.revenue, kp.revenue)} spark={ts.map((x) => x.revenue)} hint="Owned-store revenue + affiliate commission" />
        <StatTile label="Commission" value={money(k.commission, true)} delta={d(k.commission, kp.commission)} />
        <StatTile label="Profit" value={money(k.profit, true)} delta={d(k.profit, kp.profit)} hint="Commission + order margin − ad spend − AI cost" />
        <StatTile label="Orders" value={formatCompact(k.orders)} delta={d(k.orders, kp.orders)} spark={ts.map((x) => x.conversions)} />
        <StatTile label="Page views" value={formatCompact(k.pageViews)} delta={d(k.pageViews, kp.pageViews)} spark={ts.map((x) => x.views)} />
        <StatTile label="Clicks" value={formatCompact(k.clicks)} delta={d(k.clicks, kp.clicks)} spark={ts.map((x) => x.clicks)} />
        <StatTile label="Click-through" value={formatPercent(k.ctr)} delta={d(k.ctr, kp.ctr)} />
        <StatTile label="Conversion rate" value={formatPercent(k.conversionRate, 2)} delta={d(k.conversionRate, kp.conversionRate)} />
      </section>
      <p className="mt-2 text-[11px] text-dim">
        Spend {money(k.spend)} · AI cost {money(k.aiCost)} · affiliate sales value {money(k.affiliateSales)} (merchant GMV, not FORGE revenue) · {formatNumber(k.visitors)} consented visitors
      </p>

      <Panel className="mt-6" title="Daily trend" subtitle={`Last ${days} days`}>
        <TimeSeriesChart
          title="Daily trend"
          points={ts.map((x) => ({ date: x.date, values: { views: x.views, clicks: x.clicks, conversions: x.conversions, revenue: convert(x.revenue, "USD", cur, currency.rates) } }))}
          metrics={[
            { key: "views", label: "Page views", kind: "count" },
            { key: "clicks", label: "Clicks", kind: "count" },
            { key: "conversions", label: "Conversions", kind: "count" },
            { key: "revenue", label: "Revenue", kind: "currency", currency: cur },
          ]}
        />
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel title="Top platforms" subtitle="Clicks by utm_source · hover for detail">
          <BarList rows={toRows(platforms)} />
        </Panel>
        <Panel title="Top countries" subtitle="Clicks by visitor country">
          <BarList rows={toRows(countries)} emptyText="No country data (needs a CDN country header)" />
        </Panel>
        <Panel title="Traffic sources" subtitle="utm_source, else referrer host">
          <BarList rows={toRows(sources)} />
        </Panel>
        <Panel title="Top campaigns" subtitle="Clicks by utm_campaign">
          <BarList rows={toRows(campaigns)} />
        </Panel>
        <Panel title="Top content" subtitle="Clicks by utm_content">
          <BarList rows={toRows(contents)} labelWidth="10rem" />
        </Panel>
        <Panel title="Funnel" subtitle="All attributed traffic">
          <Funnel
            stages={[
              { label: "Visits", value: totals.visits },
              { label: "Product clicks", value: totals.product },
              { label: "Affiliate clicks", value: totals.aff },
              { label: "Purchases", value: totals.purchases },
            ]}
          />
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Attribution"
        subtitle="Social click → landing visit → product click → affiliate click → purchase → money, grouped by UTM"
        actions={
          <nav aria-label="Group by" className="inline-flex rounded-md border border-edge bg-night p-0.5">
            {(Object.entries(GROUPS) as Array<[keyof typeof GROUPS, string]>).map(([key, label]) => (
              <Link key={key} href={q({ by: key })} className={cn("rounded px-2.5 py-1 text-xs", key === by ? "bg-panel-3 text-fog" : "text-dim hover:text-haze")}>
                {label}
              </Link>
            ))}
          </nav>
        }
        bodyClassName="p-0"
      >
        <Table minWidth={960}>
          <thead>
            <tr>
              <Th>{GROUPS[by]}</Th>
              <Th align="end">Visits</Th>
              <Th align="end">Product clicks</Th>
              <Th align="end">Affiliate clicks</Th>
              <Th align="end">Checkouts</Th>
              <Th align="end">Purchases</Th>
              <Th align="end">Conv. rate</Th>
              <Th align="end">Sales value</Th>
              <Th align="end">Commission</Th>
            </tr>
          </thead>
          <tbody>
            {funnel.map((r) => (
              <tr key={r.key}>
                <Td className="font-mono text-xs text-fog">{r.key}</Td>
                <Td align="end">{formatNumber(r.visits)}</Td>
                <Td align="end">{formatNumber(r.productClicks)}</Td>
                <Td align="end">{formatNumber(r.affiliateClicks)}</Td>
                <Td align="end">{formatNumber(r.checkouts)}</Td>
                <Td align="end">{formatNumber(r.purchases)}</Td>
                <Td align="end">{formatPercent(r.visits ? r.purchases / r.visits : 0, 2)}</Td>
                <Td align="end">{money(r.sales)}</Td>
                <Td align="end">{money(r.commission)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel className="mt-6" title="Product leaderboard" subtitle={`Last ${days} days`} bodyClassName="p-0">
        <Table minWidth={1000}>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th align="end">Score</Th>
              <Th align="end">Traffic</Th>
              <Th align="end">Clicks</Th>
              <Th align="end">Orders</Th>
              <Th align="end">Revenue</Th>
              <Th align="end">Commission</Th>
              <Th align="end">Conversion</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {board.map((r) => (
              <tr key={r.productId} className="hover:bg-panel-2/50">
                <Td>
                  <Link href={`/admin/products/${r.productId}?tab=analytics`} className="text-fog hover:underline">
                    {r.title}
                  </Link>
                </Td>
                <Td align="end">{r.score === null ? "—" : Math.round(r.score)}</Td>
                <Td align="end">{formatNumber(r.views)}</Td>
                <Td align="end">{formatNumber(r.affiliateClicks + r.productClicks)}</Td>
                <Td align="end">{formatNumber(r.orders + r.conversions)}</Td>
                <Td align="end">{money(r.revenue)}</Td>
                <Td align="end">{money(r.commission)}</Td>
                <Td align="end">{formatPercent(r.conversionRate, 2)}</Td>
                <Td>
                  <StatusBadge status={r.status as never} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
