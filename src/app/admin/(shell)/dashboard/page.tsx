import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, Clapperboard, FlaskConical, Globe, Radar, Rocket, Trophy } from "lucide-react";
import { can } from "@/lib/rbac";
import { cn, formatCompact, formatNumber, formatPercent, round } from "@/lib/utils";
import { convert, formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { getSetting } from "@/server/settings";
import { isDemoMode } from "@/server/env";
import { breakdown, kpis, leaderboard, productStats, rangeForDays, timeseries } from "@/server/services/analytics";
import { contentPerformance } from "@/server/services/content";
import { listProducts } from "@/server/services/products";
import { latestScores } from "@/server/services/scoring";
import { listTests } from "@/server/services/testing";
import { listRecommendations } from "@/server/services/recommendations";
import { latestReport } from "@/server/services/reports";
import { COMMAND_EXAMPLES } from "@/server/command/parser";
import { Badge, ButtonLink, Callout, DemoTag, EmptyState, PageHeader, Panel, StatusBadge, Table, Td, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { ScoreMeter, StatTile } from "@/components/charts/marks";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { CommandConsole } from "@/components/admin/CommandConsole";
import { RecommendationList } from "@/components/admin/Recommendations";
import { enqueueJobAction } from "../../actions/products";
import { runCommandAction } from "../../actions/growth";

export const metadata = { title: "Dashboard" };

const RANGES = [7, 14, 30, 90];

function Highlight({ icon: Icon, label, value, sub, href }: { icon: LucideIcon; label: string; value: string; sub: string; href?: string }) {
  const body = (
    <div className="flex h-full items-start gap-3 rounded-lg border border-edge bg-panel p-4 transition-colors hover:border-edge-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-panel-2">
        <Icon aria-hidden className="h-4 w-4 text-haze" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-dim">{label}</p>
        <p className="mt-1 truncate text-sm font-medium text-fog">{value}</p>
        <p className="mt-0.5 truncate text-xs text-dim">{sub}</p>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ range?: string; denied?: string }> }) {
  const ctx = await pageContext("dashboard:read");
  const sp = await searchParams;
  const days = RANGES.includes(Number(sp.range)) ? Number(sp.range) : 30;
  const range = rangeForDays(days);
  const prevRange = { from: new Date(range.from.getTime() - days * 86400_000), to: range.from };
  const currency = await getSetting(ctx, "currency");
  const cur = currency.display;
  const money = (v: number, compact = false) => formatMoney(convert(v, "USD", cur, currency.rates), cur, "en", { compact });

  const [k, kp, ts, board, platforms, countries, perf, opps, tests, recs, report] = await Promise.all([
    kpis(ctx, range),
    kpis(ctx, prevRange),
    timeseries(ctx, range),
    leaderboard(ctx, range, 8),
    breakdown(ctx, range, "platform", 6),
    breakdown(ctx, range, "country", 6),
    contentPerformance(ctx, { since: range.from, includeDemo: isDemoMode() }),
    listProducts(ctx, { status: ["DISCOVERED", "RESEARCHING", "APPROVED"], sort: "score", limit: 6 }),
    listTests(ctx, { status: "RUNNING" }),
    listRecommendations(ctx, { status: "OPEN", limit: 5 }),
    latestReport(ctx),
  ]);
  const oppScores = await latestScores(ctx, opps.items.map((p) => p.id));
  const testStats = await Promise.all(tests.map((t) => productStats(ctx, t.test.productId, t.test.startedAt)));
  const delta = (a: number, b: number) => (b ? (a - b) / b : null);
  const topContent = [...perf].sort((a, b) => b.conversions - a.conversions || b.siteVisits - a.siteVisits)[0];
  const bestCountry = [...countries].sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks)[0];
  const profitDelta = delta(k.profit, kp.profit);
  const canAct = can(ctx.role, "agents:run");
  const hour = new Date().getUTCHours();

  return (
    <>
      {sp.denied && (
        <Callout tone="warning" className="mb-6" title="Access denied">
          Your role ({ctx.role}) can't open that page.
        </Callout>
      )}
      <PageHeader
        eyebrow={new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        title={`Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${ctx.user.name.split(" ")[0]}.`}
        description={
          <>
            {k.profit >= 0 ? "Yes — the business is making money: " : "Not yet — the business is losing money: "}
            <span className="font-medium text-fog">{money(k.profit)}</span> profit over the last {days} days
            {profitDelta !== null && (
              <>
                , {profitDelta >= 0 ? "up" : "down"} {formatPercent(Math.abs(profitDelta), 0)} vs the previous {days} days
              </>
            )}
            .{isDemoMode() && <span className="ms-2 align-middle"><DemoTag /></span>}
          </>
        }
        actions={
          <nav aria-label="Date range" className="inline-flex rounded-md border border-edge bg-panel p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={`/admin/dashboard?range=${r}`} aria-current={r === days ? "true" : undefined} className={cn("rounded px-3 py-1 text-xs", r === days ? "bg-panel-3 text-fog" : "text-dim hover:text-haze")}>
                {r}d
              </Link>
            ))}
          </nav>
        }
      />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Revenue" value={money(k.revenue, true)} delta={delta(k.revenue, kp.revenue)} spark={ts.map((d) => d.revenue)} hint="Owned-store revenue + affiliate commission" />
        <StatTile label="Commission" value={money(k.commission, true)} delta={delta(k.commission, kp.commission)} />
        <StatTile label="Profit" value={money(k.profit, true)} delta={profitDelta} hint="Commission + (order revenue − COGS − shipping) − ad spend − AI cost" />
        <StatTile label="Orders" value={formatCompact(k.orders)} delta={delta(k.orders, kp.orders)} spark={ts.map((d) => d.conversions)} hint="Store orders + affiliate purchases" />
        <StatTile label="Clicks" value={formatCompact(k.clicks)} delta={delta(k.clicks, kp.clicks)} spark={ts.map((d) => d.clicks)} hint="Product + affiliate clicks" />
        <StatTile label="Conversion rate" value={formatPercent(k.conversionRate, 2)} delta={delta(k.conversionRate, kp.conversionRate)} spark={ts.map((d) => (d.views ? d.conversions / d.views : 0))} hint="Orders ÷ page views" />
      </section>

      <section aria-label="Highlights" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Highlight icon={Trophy} label="Top product" value={board[0]?.title ?? "—"} sub={board[0] ? `${money(board[0].revenue)} · ${formatNumber(board[0].affiliateClicks + board[0].productClicks)} clicks` : "No sales yet"} href={board[0] ? `/admin/products/${board[0].productId}` : undefined} />
        <Highlight icon={Radar} label="Top platform" value={platforms[0]?.key ?? "—"} sub={platforms[0] ? `${formatNumber(platforms[0].clicks)} clicks · ${formatNumber(platforms[0].conversions)} conversions` : "No tracked traffic"} href="/admin/analytics" />
        <Highlight icon={Clapperboard} label="Top content" value={topContent?.title ?? "—"} sub={topContent ? `${topContent.platform.toLowerCase()} · ${formatNumber(topContent.siteVisits)} visits · ${topContent.conversions} conv.` : "Publish content to see this"} href="/admin/content" />
        <Highlight icon={Globe} label="Best country" value={bestCountry?.key ?? "—"} sub={bestCountry ? `${formatNumber(bestCountry.conversions)} conversions · ${formatNumber(bestCountry.clicks)} clicks` : "No conversions yet"} href="/admin/analytics" />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Performance" subtitle={`Daily, last ${days} days · bot traffic excluded`} className="xl:col-span-2">
          <TimeSeriesChart
            title="Performance"
            points={ts.map((d) => ({ date: d.date, values: { views: d.views, clicks: d.clicks, conversions: d.conversions, revenue: convert(d.revenue, "USD", cur, currency.rates) } }))}
            metrics={[
              { key: "revenue", label: "Revenue", kind: "currency", currency: cur },
              { key: "clicks", label: "Clicks", kind: "count" },
              { key: "views", label: "Page views", kind: "count" },
              { key: "conversions", label: "Conversions", kind: "count" },
            ]}
          />
        </Panel>
        <Panel title="Ask FORGE" subtitle="Natural-language commands → queries and background jobs">
          <CommandConsole action={runCommandAction} examples={COMMAND_EXAMPLES} compact />
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Product opportunities"
        subtitle="Highest-scoring products not yet in a test"
        actions={
          <>
            {report && (
              <ButtonLink href={`/admin/reports/${report.id}`} size="sm" variant="ghost">
                Latest Top 5 <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
              </ButtonLink>
            )}
            <ButtonLink href="/admin/products/discover" size="sm">
              Discover more
            </ButtonLink>
          </>
        }
        bodyClassName="p-0"
      >
        {opps.items.length ? (
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Score</Th>
                <Th>Why</Th>
                <Th>Status</Th>
                <Th align="end">Action</Th>
              </tr>
            </thead>
            <tbody>
              {opps.items.map((p) => {
                const s = oppScores.get(p.id);
                return (
                  <tr key={p.id} className="hover:bg-panel-2/50">
                    <Td>
                      <Link href={`/admin/products/${p.id}`} className="font-medium text-fog hover:underline">
                        {p.title}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-dim">
                        {p.categoryName ?? "Uncategorised"} · {p.businessModel.toLowerCase()}
                        {p.isDemo && <DemoTag />}
                      </div>
                    </Td>
                    <Td className="w-40">
                      <div className="flex items-center gap-2">
                        <span className="tabular w-8 font-semibold text-fog">{p.overallScore === null ? "—" : Math.round(p.overallScore)}</span>
                        <ScoreMeter value={p.overallScore} className="w-20" />
                      </div>
                      <div className="mt-1 text-[11px] text-dim">confidence {p.scoreConfidence === null ? "—" : round(p.scoreConfidence, 2)}</div>
                    </Td>
                    <Td className="max-w-md text-xs">{s?.reasons.slice(0, 2).join(" · ") || "—"}</Td>
                    <Td>
                      <StatusBadge status={p.status} />
                    </Td>
                    <Td align="end">
                      {canAct ? (
                        <ActionForm action={enqueueJobAction} className="inline-block">
                          <input type="hidden" name="job" value="launch_test_kit" />
                          <input type="hidden" name="productId" value={p.id} />
                          <SubmitButton size="sm" variant="secondary" pendingText="Queuing…">
                            <Rocket aria-hidden className="h-3.5 w-3.5" /> Launch kit
                          </SubmitButton>
                        </ActionForm>
                      ) : (
                        <ButtonLink href={`/admin/products/${p.id}`} size="sm">
                          Open
                        </ButtonLink>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No opportunities yet" action={<ButtonLink href="/admin/products/discover">Run discovery</ButtonLink>}>
              Import a product feed or run discovery to fill the pipeline.
            </EmptyState>
          </div>
        )}
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Active tests" subtitle="Running product tests and their live numbers" actions={<ButtonLink href="/admin/products/testing" size="sm" variant="ghost">All tests</ButtonLink>}>
          {tests.length ? (
            <ul className="divide-y divide-edge">
              {tests.map((t, i) => {
                const s = testStats[i];
                const day = Math.floor((Date.now() - t.test.startedAt.getTime()) / 86400_000);
                const clicks = s.affiliateClicks + s.productClicks;
                return (
                  <li key={t.test.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/admin/products/${t.test.productId}`} className="min-w-0 truncate text-sm font-medium text-fog hover:underline">
                        {t.title}
                      </Link>
                      <Badge tone={t.test.verdict === "WINNER" ? "good" : t.test.verdict === "FAILURE" ? "critical" : "info"} icon={FlaskConical}>
                        {t.test.verdict ? t.test.verdict.toLowerCase().replace("_", " ") : "running"}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-dim">Day</p>
                        <p className="tabular text-fog">
                          {day} / {t.test.plannedDays}
                        </p>
                      </div>
                      <div>
                        <p className="text-dim">Views</p>
                        <p className="tabular text-fog">{formatNumber(s.pageViews)}</p>
                      </div>
                      <div>
                        <p className="text-dim">CTR</p>
                        <p className="tabular text-fog">{formatPercent(s.pageViews ? clicks / s.pageViews : 0)}</p>
                      </div>
                      <div>
                        <p className="text-dim">Conv.</p>
                        <p className="tabular text-fog">{formatPercent(s.pageViews ? s.conversions / s.pageViews : 0, 2)}</p>
                      </div>
                    </div>
                    <div className="mt-2 h-1 rounded-full bg-b800">
                      <div className="h-full rounded-full bg-s1" style={{ width: `${Math.min(100, (day / t.test.plannedDays) * 100)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={FlaskConical} title="No running tests">
              Launch a kit on an opportunity, publish its page, then start a test.
            </EmptyState>
          )}
        </Panel>
        <Panel title="AI recommendations" subtitle="Computed from your actual metrics — each carries its evidence" actions={<ButtonLink href="/admin/notifications" size="sm" variant="ghost">History</ButtonLink>}>
          <RecommendationList items={recs} canAct={canAct} />
        </Panel>
      </div>

      <Panel className="mt-6" title="Product leaderboard" subtitle={`Last ${days} days`} actions={<ButtonLink href="/admin/analytics" size="sm" variant="ghost">Full analytics</ButtonLink>} bodyClassName="p-0">
        <Table minWidth={900}>
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
                  <Link href={`/admin/products/${r.productId}`} className="text-fog hover:underline">
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
