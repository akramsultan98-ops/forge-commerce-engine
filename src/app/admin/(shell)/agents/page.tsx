import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Bot } from "lucide-react";
import type { JobType } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatRelative, round } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { agentRuns, products } from "@/server/db/schema";
import { AGENTS } from "@/server/agents/registry";
import { resolveEngine } from "@/server/ai/service";
import { Badge, Callout, EmptyState, EngineBadge, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { enqueueJobAction } from "../../actions/products";

export const metadata = { title: "Agents" };

const RUNNERS: Partial<Record<string, { job: JobType; label: string; type?: string }>> = {
  orchestrator: { job: "first_run", label: "Run first-run pipeline" },
  trend: { job: "trend_refresh", label: "Refresh trends" },
  scoring: { job: "product_scoring", label: "Re-score all" },
  analytics: { job: "analytics_sync", label: "Sync analytics" },
  optimization: { job: "recommendations_refresh", label: "Optimize now" },
  reporting: { job: "report_generation", label: "Build Top 5", type: "TOP5_DAILY" },
};

export default async function AgentsPage() {
  const ctx = await pageContext("logs:read");
  const [runs, stats, strong, fast] = await Promise.all([
    ctx.db
      .select({ run: agentRuns, productTitle: products.title })
      .from(agentRuns)
      .leftJoin(products, eq(products.id, agentRuns.productId))
      .where(eq(agentRuns.organizationId, ctx.orgId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(60),
    ctx.db
      .select({
        agent: agentRuns.agent,
        n: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${agentRuns.status} = 'failed')::int`,
        avgMs: sql<number>`coalesce(avg(${agentRuns.durationMs}), 0)::float8`,
        cost: sql<number>`coalesce(sum(${agentRuns.costUsd}), 0)::float8`,
        last: sql<string>`max(${agentRuns.createdAt})`,
      })
      .from(agentRuns)
      .where(eq(agentRuns.organizationId, ctx.orgId))
      .groupBy(agentRuns.agent),
    resolveEngine(ctx, "research"),
    resolveEngine(ctx, "copywriting"),
  ]);
  const byAgent = new Map(stats.map((s) => [s.agent, s]));
  const canRun = can(ctx.role, "agents:run");

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="FORGE Orchestrator & agents"
        description="The orchestrator composes specialist agents into pipelines. Every run is recorded with its input, output, logs, duration and the tokens/cost of any AI calls it made."
      />
      <div className="mb-6 grid gap-3 md:grid-cols-2">
        <Callout tone={strong.engine === "AI" ? "info" : "warning"} title={`Strong tier (research, reports, strategy): ${strong.engine === "AI" ? `${strong.provider} · ${strong.model}` : "template engine"}`}>
          {strong.reason ?? "AI output is labelled AI_INFERENCE."}
        </Callout>
        <Callout tone={fast.engine === "AI" ? "info" : "warning"} title={`Fast tier (copy, pages, content, commands): ${fast.engine === "AI" ? `${fast.provider} · ${fast.model}` : "template engine"}`}>
          {fast.reason ?? "Configure models in Settings → AI."}
        </Callout>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {AGENTS.map((a) => {
          const s = byAgent.get(a.name);
          const runner = RUNNERS[a.name];
          return (
            <Panel key={a.name} className={a.name === "orchestrator" ? "md:col-span-2 2xl:col-span-3" : undefined}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 font-medium text-fog">
                    <Bot aria-hidden className="h-4 w-4 text-dim" /> {a.title}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-haze">{a.description}</p>
                </div>
                <Badge tone={a.tier === "strong" ? "ai" : a.tier === "fast" ? "info" : "neutral"}>{a.tier === "none" ? "deterministic" : `${a.tier} tier`}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-3 text-xs text-dim">
                <span>
                  {s ? `${s.n} runs · ${s.failed} failed · avg ${round(s.avgMs / 1000, 1)}s · $${round(s.cost, 4)} · last ${formatRelative(new Date(s.last))}` : "never run"}
                </span>
                {runner && canRun && (
                  <ActionForm action={enqueueJobAction} className="inline-block">
                    <input type="hidden" name="job" value={runner.job} />
                    {runner.type && <input type="hidden" name="type" value={runner.type} />}
                    <SubmitButton size="sm" variant="secondary" pendingText="Queuing…">
                      {runner.label}
                    </SubmitButton>
                  </ActionForm>
                )}
                {!runner && <span>Runs per product (open a product)</span>}
              </div>
            </Panel>
          );
        })}
      </div>

      <Panel className="mt-6" title="Recent runs" bodyClassName="p-0">
        {runs.length ? (
          <Table minWidth={1100}>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Product</Th>
                <Th>Status</Th>
                <Th>Engine</Th>
                <Th align="end">Tokens</Th>
                <Th align="end">Cost</Th>
                <Th align="end">Duration</Th>
                <Th>Started</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map(({ run, productTitle }) => (
                <tr key={run.id} className="align-top">
                  <Td>
                    <span className="text-fog">{run.agent}</span>
                    {run.parentRunId && <p className="text-[11px] text-dim">child of {run.parentRunId.slice(0, 8)}</p>}
                  </Td>
                  <Td className="text-xs">{run.productId ? <Link href={`/admin/products/${run.productId}`} className="hover:underline">{productTitle}</Link> : "—"}</Td>
                  <Td>
                    <Badge tone={run.status === "succeeded" ? "good" : run.status === "failed" ? "critical" : "info"}>{run.status}</Badge>
                  </Td>
                  <Td>{run.generationMethod ? <EngineBadge method={run.generationMethod} model={run.model} /> : <span className="text-xs text-dim">deterministic</span>}</Td>
                  <Td align="end">{run.inputTokens + run.outputTokens || "—"}</Td>
                  <Td align="end">{run.costUsd ? `$${round(run.costUsd, 4)}` : "—"}</Td>
                  <Td align="end">{run.durationMs !== null ? `${round(run.durationMs / 1000, 1)}s` : "…"}</Td>
                  <Td className="text-xs">{formatRelative(run.createdAt)}</Td>
                  <Td className="max-w-xs">
                    <details>
                      <summary className="text-xs text-haze hover:text-fog">Logs & output</summary>
                      <div className="mt-2 space-y-1 text-[11px]">
                        {run.logs.map((l, i) => (
                          <p key={i} className={l.level === "error" ? "text-[#ff9b9b]" : "text-dim"}>
                            {l.at.slice(11, 19)} {l.msg}
                          </p>
                        ))}
                        {run.error && <p className="text-[#ff9b9b]">{run.error}</p>}
                        <pre className="max-h-48 overflow-auto rounded bg-night p-2 font-mono text-[10px] text-haze scrollbar-thin">{JSON.stringify(run.output, null, 2)?.slice(0, 3000)}</pre>
                      </div>
                    </details>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={Bot} title="No agent runs yet" />
          </div>
        )}
      </Panel>
    </>
  );
}
