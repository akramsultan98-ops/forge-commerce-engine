import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { can } from "@/lib/rbac";
import { formatRelative, round } from "@/lib/utils";
import { describeCron } from "@/domain/cron";
import { pageContext } from "@/server/auth/session";
import { apiRequestLogs, auditLogs, automationRuns, jobs, jobSchedules, users } from "@/server/db/schema";
import { getDbDriver } from "@/server/db/client";
import { env } from "@/server/env";
import { integrationOverview } from "@/server/integrations/status";
import { JOB_LABELS } from "@/server/jobs/handlers";
import { Badge, EmptyState, Input, KeyValue, Mono, PageHeader, Panel, Table, Tabs, Td, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { jobAction } from "../../actions/growth";
import { scheduleAction } from "../../actions/system";

export const metadata = { title: "Logs" };

const TABS = ["automations", "jobs", "audit", "api", "health"] as const;
type Tab = (typeof TABS)[number];
const statusTone = (s: string) => (s === "succeeded" ? "good" : s === "failed" ? "critical" : s === "running" ? "info" : s === "cancelled" ? "neutral" : "warning") as "good" | "critical" | "info" | "neutral" | "warning";

async function Automations({ orgId, canEdit, db }: { orgId: string; canEdit: boolean; db: Awaited<ReturnType<typeof pageContext>>["db"] }) {
  const [schedules, runs] = await Promise.all([
    db.select().from(jobSchedules).where(eq(jobSchedules.organizationId, orgId)).orderBy(jobSchedules.key),
    db.select().from(automationRuns).where(eq(automationRuns.organizationId, orgId)).orderBy(desc(automationRuns.startedAt)).limit(60),
  ]);
  return (
    <div className="space-y-6">
      <Panel title="Schedules" subtitle="Cron (5-field, UTC). The worker enqueues due schedules every 30s; de-duplication makes this safe with many workers." bodyClassName="p-0">
        <Table minWidth={980}>
          <thead>
            <tr>
              <Th>Automation</Th>
              <Th>Job</Th>
              <Th>Schedule</Th>
              <Th>Next run</Th>
              <Th>Last enqueued</Th>
              <Th>{canEdit ? "Edit" : "Enabled"}</Th>
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id}>
                <Td>
                  <p className="text-fog">{s.description}</p>
                  <Mono>{s.key}</Mono>
                </Td>
                <Td className="text-xs">{JOB_LABELS[s.jobType as keyof typeof JOB_LABELS] ?? s.jobType}</Td>
                <Td className="text-xs">
                  {describeCron(s.cron)} <Mono>{s.cron}</Mono>
                </Td>
                <Td className="text-xs">{s.enabled && s.nextRunAt ? formatRelative(s.nextRunAt) : "—"}</Td>
                <Td className="text-xs">{s.lastEnqueuedAt ? formatRelative(s.lastEnqueuedAt) : "never"}</Td>
                <Td>
                  {canEdit ? (
                    <ActionForm action={scheduleAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={s.id} />
                      <Input name="cron" defaultValue={s.cron} className="h-8 w-32 font-mono text-xs" aria-label="Cron expression" />
                      <label className="flex items-center gap-1 text-xs text-haze">
                        <input type="checkbox" name="enabled" defaultChecked={s.enabled} className="accent-s1" /> on
                      </label>
                      <SubmitButton size="sm" variant="ghost">
                        Save
                      </SubmitButton>
                    </ActionForm>
                  ) : (
                    <Badge tone={s.enabled ? "good" : "neutral"}>{s.enabled ? "enabled" : "disabled"}</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Automation runs" bodyClassName="p-0">
        {runs.length ? (
          <Table minWidth={980}>
            <thead>
              <tr>
                <Th>Automation</Th>
                <Th>Trigger</Th>
                <Th>Status</Th>
                <Th align="end">Duration</Th>
                <Th>Started</Th>
                <Th>Summary</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="align-top">
                  <Td className="text-fog">{JOB_LABELS[r.automation as keyof typeof JOB_LABELS] ?? r.automation}</Td>
                  <Td className="text-xs">{r.trigger.toLowerCase()}</Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td align="end">{r.durationMs !== null ? `${round(r.durationMs / 1000, 1)}s` : "…"}</Td>
                  <Td className="text-xs">{formatRelative(r.startedAt)}</Td>
                  <Td className="max-w-md">
                    {r.error ? (
                      <p className="text-xs text-[#ff9b9b]">{r.error.slice(0, 240)}</p>
                    ) : (
                      <details>
                        <summary className="text-xs text-haze hover:text-fog">Result</summary>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-night p-2 font-mono text-[10px] text-haze scrollbar-thin">{JSON.stringify(r.summary, null, 2).slice(0, 2500)}</pre>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No automation runs yet" />
          </div>
        )}
      </Panel>
    </div>
  );
}

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext("logs:read");
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "automations";
  const canJobs = can(ctx.role, "jobs:run");

  return (
    <>
      <PageHeader eyebrow="System" title="Logs & observability" description="Job monitoring, automation history, audit trail, API request log and health checks. Agent execution logs live on the Agents page." />
      <Tabs items={TABS.map((t) => ({ href: `/admin/logs?tab=${t}`, label: t === "api" ? "API requests" : t[0].toUpperCase() + t.slice(1), active: t === tab }))} />
      <div className="mt-6">
        {tab === "automations" && <Automations orgId={ctx.orgId} canEdit={can(ctx.role, "settings:write")} db={ctx.db} />}
        {tab === "jobs" && <JobsTab ctx={ctx} canJobs={canJobs} />}
        {tab === "audit" && <AuditTab ctx={ctx} />}
        {tab === "api" && <ApiTab ctx={ctx} />}
        {tab === "health" && <HealthTab ctx={ctx} />}
      </div>
    </>
  );
}

async function JobsTab({ ctx, canJobs }: { ctx: Awaited<ReturnType<typeof pageContext>>; canJobs: boolean }) {
  const rows = await ctx.db.select().from(jobs).where(eq(jobs.organizationId, ctx.orgId)).orderBy(desc(jobs.id)).limit(100);
  return (
    <Panel title="Job queue" subtitle="Postgres-backed; claimed with FOR UPDATE SKIP LOCKED; exponential backoff; stale locks recovered" bodyClassName="p-0">
      {rows.length ? (
        <Table minWidth={1000}>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th align="end">Attempts</Th>
              <Th>Trigger</Th>
              <Th>Created</Th>
              <Th>Error</Th>
              <Th align="end" />
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id}>
                <Td className="tabular text-xs">{j.id}</Td>
                <Td className="text-fog">{JOB_LABELS[j.type as keyof typeof JOB_LABELS] ?? j.type}</Td>
                <Td>
                  <Badge tone={statusTone(j.status)}>{j.status}</Badge>
                </Td>
                <Td align="end">
                  {j.attempts}/{j.maxAttempts}
                </Td>
                <Td className="text-xs">{j.trigger.toLowerCase()}</Td>
                <Td className="text-xs">{formatRelative(j.createdAt)}</Td>
                <Td className="max-w-xs truncate text-xs text-[#ff9b9b]" >{j.lastError ?? ""}</Td>
                <Td align="end">
                  {canJobs && (j.status === "failed" || j.status === "cancelled" || j.status === "queued") && (
                    <ActionForm action={jobAction}>
                      <input type="hidden" name="id" value={j.id} />
                      <input type="hidden" name="op" value={j.status === "queued" ? "cancel" : "retry"} />
                      <SubmitButton size="sm" variant="ghost">
                        {j.status === "queued" ? "Cancel" : "Retry"}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="p-5">
          <EmptyState title="Queue is empty" />
        </div>
      )}
    </Panel>
  );
}

async function AuditTab({ ctx }: { ctx: Awaited<ReturnType<typeof pageContext>> }) {
  const rows = await ctx.db
    .select({ log: auditLogs, email: users.email })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(eq(auditLogs.organizationId, ctx.orgId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(150);
  return (
    <Panel title="Audit trail" subtitle="Append-only; secrets are redacted before they are written" bodyClassName="p-0">
      <Table minWidth={1000}>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Entity</Th>
            <Th>Details</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ log, email }) => (
            <tr key={log.id}>
              <Td className="text-xs">{formatRelative(log.createdAt)}</Td>
              <Td className="text-xs">
                {email ?? log.actor}
                {log.ip && <p className="text-dim">{log.ip}</p>}
              </Td>
              <Td>
                <Mono>{log.action}</Mono>
              </Td>
              <Td className="text-xs">
                {log.entityType}
                {log.entityId && (
                  <>
                    {" "}
                    {log.entityType === "product" ? (
                      <Link href={`/admin/products/${log.entityId}`} className="text-dim hover:text-haze">
                        {log.entityId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span className="text-dim">{log.entityId.slice(0, 12)}</span>
                    )}
                  </>
                )}
              </Td>
              <Td className="max-w-md truncate font-mono text-[11px] text-dim">{Object.keys(log.meta).length ? JSON.stringify(log.meta) : ""}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}

async function ApiTab({ ctx }: { ctx: Awaited<ReturnType<typeof pageContext>> }) {
  const rows = await ctx.db.select().from(apiRequestLogs).where(eq(apiRequestLogs.organizationId, ctx.orgId)).orderBy(desc(apiRequestLogs.createdAt)).limit(150);
  return (
    <Panel title="API requests" subtitle="Authenticated /api/v1 calls (IPs stored as keyed hashes)" bodyClassName="p-0">
      {rows.length ? (
        <Table minWidth={860}>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Request</Th>
              <Th align="end">Status</Th>
              <Th align="end">Duration</Th>
              <Th>Actor</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs">{formatRelative(r.createdAt)}</Td>
                <Td>
                  <Mono>
                    {r.method} {r.path}
                  </Mono>
                </Td>
                <Td align="end">
                  <Badge tone={r.status < 400 ? "good" : r.status < 500 ? "warning" : "critical"}>{r.status}</Badge>
                </Td>
                <Td align="end">{r.durationMs}ms</Td>
                <Td className="text-xs">{r.actor}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <div className="p-5">
          <EmptyState title="No API requests logged yet" />
        </div>
      )}
    </Panel>
  );
}

async function HealthTab({ ctx }: { ctx: Awaited<ReturnType<typeof pageContext>> }) {
  const t = Date.now();
  const q = await ctx.db.execute(sql`
    select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'running')::int as running,
           count(*) filter (where status = 'failed' and finished_at > now() - interval '1 day')::int as failed24h,
           (select count(*) from jobs where status = 'running' and locked_at < now() - interval '21 minutes')::int as stale
    from jobs`);
  const dbMs = Date.now() - t;
  const row = q.rows[0] as { queued: number; running: number; failed24h: number; stale: number };
  const overview = await integrationOverview(ctx);
  const ok = (b: boolean) => <Badge tone={b ? "good" : "neutral"}>{b ? "configured" : "not configured"}</Badge>;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Panel title="Runtime">
        <KeyValue
          items={[
            { k: "Database", v: `${getDbDriver()} · ${dbMs}ms round-trip` },
            { k: "Job runner", v: env().JOB_RUNNER },
            { k: "Queue", v: `${row.queued} queued · ${row.running} running · ${row.stale} stale` },
            { k: "Failed jobs (24h)", v: <Badge tone={row.failed24h ? "critical" : "good"}>{row.failed24h}</Badge> },
            { k: "DEMO_MODE", v: overview.demoMode ? "on (outbound blocked)" : "off" },
            { k: "Node.js", v: process.version },
            { k: "Error tracking", v: env().ERROR_TRACKING_DSN ? "Sentry-compatible DSN set" : "log only" },
            { k: "Public health endpoint", v: <Mono>/api/health</Mono> },
          ]}
        />
      </Panel>
      <Panel title="Integrations">
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
            <span className="text-haze">AI engine</span>
            <Badge tone={overview.ai.engine.engine === "AI" ? "good" : "warning"}>{overview.ai.engine.engine === "AI" ? `${overview.ai.engine.provider}` : "template"}</Badge>
          </li>
          <li className="flex justify-between">
            <span className="text-haze">Shopify</span>
            {ok(overview.shopify.connected)}
          </li>
          <li className="flex justify-between">
            <span className="text-haze">Email</span>
            {ok(overview.email.configured)}
          </li>
          <li className="flex justify-between">
            <span className="text-haze">Telegram</span>
            {ok(overview.telegram.configured)}
          </li>
          {overview.social.map((s) => (
            <li key={s.platform} className="flex justify-between">
              <span className="text-haze">
                {s.label} <span className="text-dim">({s.mode})</span>
              </span>
              {ok(s.configured)}
            </li>
          ))}
          <li className="flex justify-between">
            <span className="text-haze">Discovery sources connected</span>
            <span className="text-fog">
              {overview.sources.filter((s) => s.status === "CONNECTED").length}/{overview.sources.length}
            </span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
