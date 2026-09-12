import Link from "next/link";
import { sql } from "drizzle-orm";
import { formatNumber, formatRelative, isoDate, round } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { getSetting } from "@/server/settings";
import { providerStatus } from "@/server/ai/registry";
import { MODEL_PRICES } from "@/server/ai/pricing";
import { monthToDateSpend } from "@/server/ai/service";
import { isDemoMode } from "@/server/env";
import { Badge, ButtonLink, Callout, KeyValue, Mono, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";
import { ScoreMeter, StatTile } from "@/components/charts/marks";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";

export const metadata = { title: "AI usage" };

type Agg = { key: string; calls: number; input: number; output: number; cost: number; cached: number; failed: number };

export default async function AiUsagePage() {
  const ctx = await pageContext("settings:read");
  const since = new Date(Date.now() - 30 * 86400_000);
  const q = (group: string) =>
    ctx.db.execute(sql`
      select ${sql.raw(group)} as key, count(*)::int as calls, coalesce(sum(input_tokens), 0)::int as input, coalesce(sum(output_tokens), 0)::int as output,
             coalesce(sum(estimated_cost_usd), 0)::float8 as cost, count(*) filter (where cached)::int as cached, count(*) filter (where not success)::int as failed
      from ai_usage where organization_id = ${ctx.orgId} and created_at >= ${since.toISOString()}::timestamptz
      group by 1 order by cost desc, calls desc`);
  const [byModel, byTask, byDay, recent, routing, spend] = await Promise.all([
    q("provider || ' · ' || model"),
    q("task"),
    q("to_char(date_trunc('day', created_at at time zone 'UTC'), 'YYYY-MM-DD')"),
    ctx.db.execute(sql`select u.*, p.title as product_title from ai_usage u left join products p on p.id = u.product_id where u.organization_id = ${ctx.orgId} order by u.created_at desc limit 50`),
    getSetting(ctx, "ai.routing"),
    monthToDateSpend(ctx),
  ]);
  const models = byModel.rows as unknown as Agg[];
  const tasks = byTask.rows as unknown as Agg[];
  const daysMap = new Map((byDay.rows as unknown as Agg[]).map((r) => [r.key, r]));
  const series = Array.from({ length: 30 }, (_, i) => isoDate(new Date(since.getTime() + (i + 1) * 86400_000))).map((d) => ({ date: d, values: { cost: daysMap.get(d)?.cost ?? 0, calls: daysMap.get(d)?.calls ?? 0 } }));
  const totals = models.reduce((a, m) => ({ calls: a.calls + m.calls, tokens: a.tokens + m.input + m.output, cost: a.cost + m.cost, cached: a.cached + m.cached, failed: a.failed + m.failed }), { calls: 0, tokens: 0, cost: 0, cached: 0, failed: 0 });
  const recentRows = recent.rows as unknown as Array<{ id: string; created_at: string; provider: string; model: string; task: string; tier: string; product_title: string | null; product_id: string | null; input_tokens: number; output_tokens: number; estimated_cost_usd: string | number; cached: boolean; success: boolean }>;
  const budgetPct = routing.monthlyBudgetUsd > 0 ? (spend / routing.monthlyBudgetUsd) * 100 : 0;

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="AI usage & cost"
        description="Every AI call is recorded with provider, model, tokens, estimated cost, task and product. Cheaper models handle simple tasks; stronger models handle research and strategy. Repeated prompts are served from cache."
        actions={<ButtonLink href="/admin/settings?tab=ai">Routing & budget</ButtonLink>}
      />
      {isDemoMode() && (
        <Callout tone="warning" className="mb-6" title="DEMO_MODE: no paid AI calls">
          Every generation ran on the deterministic template engine (recorded as provider “template”, cost $0).
        </Callout>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Month-to-date spend" value={`$${round(spend, 2)}`} hint="Estimated from token counts × list prices" />
        <StatTile label="Calls (30d)" value={formatNumber(totals.calls)} spark={series.map((s) => s.values.calls)} />
        <StatTile label="Tokens (30d)" value={formatNumber(totals.tokens)} />
        <StatTile label="Cache hits" value={totals.calls ? `${Math.round((totals.cached / totals.calls) * 100)}%` : "—"} />
        <StatTile label="Failed calls" value={formatNumber(totals.failed)} hint="Failures fall back to the template engine" />
      </div>
      <Panel className="mt-6" title="Monthly budget">
        <div className="flex items-center gap-4">
          <ScoreMeter value={Math.min(100, budgetPct)} className="flex-1" />
          <span className="tabular text-sm text-fog">
            ${round(spend, 2)} / ${routing.monthlyBudgetUsd}
          </span>
        </div>
        <p className="mt-2 text-xs text-dim">When the budget is reached, AI tasks fall back to the template engine until the next month — nothing silently overspends.</p>
      </Panel>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Daily cost (30 days)">
          <TimeSeriesChart title="AI cost" points={series} metrics={[{ key: "cost", label: "Cost", kind: "currency", currency: "USD" }, { key: "calls", label: "Calls", kind: "count" }]} height={200} />
        </Panel>
        <Panel title="Routing">
          <KeyValue
            items={[
              { k: "Provider", v: routing.provider },
              { k: "Fast model", v: <Mono>{routing.fastModel}</Mono> },
              { k: "Strong model", v: <Mono>{routing.strongModel}</Mono> },
              { k: "Cache TTL", v: `${routing.cacheTtlHours}h` },
            ]}
          />
          <p className="eyebrow mb-2 mt-5 text-dim">Task tiers</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(routing.taskTiers).map(([t, tier]) => (
              <Badge key={t} tone={tier === "strong" ? "ai" : "info"}>
                {t} · {tier}
              </Badge>
            ))}
          </div>
          <p className="eyebrow mb-2 mt-5 text-dim">Providers</p>
          <ul className="space-y-1 text-xs">
            {providerStatus().map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span className="text-haze">{p.label}</span>
                <Badge tone={p.configured ? "good" : "neutral"}>{p.configured ? "configured" : p.requirements[0]}</Badge>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        {[
          { title: "By provider & model", rows: models },
          { title: "By task", rows: tasks },
        ].map((block) => (
          <Panel key={block.title} title={block.title} bodyClassName="p-0">
            <Table minWidth={560}>
              <thead>
                <tr>
                  <Th>{block.title === "By task" ? "Task" : "Provider · model"}</Th>
                  <Th align="end">Calls</Th>
                  <Th align="end">Input</Th>
                  <Th align="end">Output</Th>
                  <Th align="end">Cached</Th>
                  <Th align="end">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {block.rows.map((r) => (
                  <tr key={r.key}>
                    <Td className="font-mono text-xs text-fog">{r.key}</Td>
                    <Td align="end">{formatNumber(r.calls)}</Td>
                    <Td align="end">{formatNumber(r.input)}</Td>
                    <Td align="end">{formatNumber(r.output)}</Td>
                    <Td align="end">{formatNumber(r.cached)}</Td>
                    <Td align="end">${round(r.cost, 4)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ))}
      </div>
      <Panel className="mt-6" title="Price list used for estimates" subtitle="USD per 1M tokens. Unverified entries must be confirmed against the vendor's pricing page." bodyClassName="p-0">
        <Table minWidth={520}>
          <thead>
            <tr>
              <Th>Model</Th>
              <Th align="end">Input</Th>
              <Th align="end">Output</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(MODEL_PRICES).map(([m, p]) => (
              <tr key={m}>
                <Td className="font-mono text-xs text-fog">{m}</Td>
                <Td align="end">${p.input}</Td>
                <Td align="end">${p.output}</Td>
                <Td>
                  <Badge tone={p.verified ? "good" : "warning"}>{p.verified ? "list price" : "unverified"}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel className="mt-6" title="Recent calls" bodyClassName="p-0">
        <Table minWidth={1000}>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Provider · model</Th>
              <Th>Task</Th>
              <Th>Product</Th>
              <Th align="end">Tokens</Th>
              <Th align="end">Cost</Th>
              <Th>Result</Th>
            </tr>
          </thead>
          <tbody>
            {recentRows.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs">{formatRelative(new Date(r.created_at))}</Td>
                <Td className="font-mono text-xs text-fog">
                  {r.provider} · {r.model}
                </Td>
                <Td className="text-xs">
                  {r.task} <span className="text-dim">({r.tier})</span>
                </Td>
                <Td className="text-xs">{r.product_id ? <Link href={`/admin/products/${r.product_id}`} className="hover:underline">{r.product_title}</Link> : "—"}</Td>
                <Td align="end">{formatNumber(r.input_tokens + r.output_tokens)}</Td>
                <Td align="end">${round(Number(r.estimated_cost_usd), 5)}</Td>
                <Td>{!r.success ? <Badge tone="critical">failed</Badge> : r.cached ? <Badge tone="info">cache hit</Badge> : <Badge tone="good">ok</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
