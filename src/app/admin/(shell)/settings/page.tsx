import { desc, eq } from "drizzle-orm";
import { CURRENCIES, MARKETS, USER_ROLES } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatRelative } from "@/lib/utils";
import { FACTOR_META, SCORING_FACTORS } from "@/domain/scoring";
import { pageContext } from "@/server/auth/session";
import { apiKeys, users } from "@/server/db/schema";
import { AI_TASKS, getSetting } from "@/server/settings";
import { providerStatus } from "@/server/ai/registry";
import { DEFAULT_MODELS } from "@/server/ai/pricing";
import { Badge, Callout, Field, Input, Mono, PageHeader, Panel, Select, Table, Tabs, Td, Textarea, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { apiKeyAction, createUserAction, saveSettingAction, updateUserAction } from "../../actions/system";

export const metadata = { title: "Settings" };

const TABS = ["scoring", "testing", "ai", "currency", "notifications", "discovery", "storefront", "users", "api-keys"] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = { scoring: "Scoring", testing: "Testing", ai: "AI", currency: "Currency & markets", notifications: "Notifications", discovery: "Discovery", storefront: "Storefront", users: "Users", "api-keys": "API keys" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext("settings:read");
  const { tab: raw } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(raw ?? "") ? (raw as Tab) : "scoring";
  const canWrite = can(ctx.role, "settings:write");
  const visible = TABS.filter((t) => (t === "users" ? can(ctx.role, "users:manage") : t === "api-keys" ? can(ctx.role, "apikeys:manage") : true));

  return (
    <>
      <PageHeader eyebrow="System" title="Settings" description={canWrite ? "Changes are validated, audited and take effect immediately." : "Read-only — only admins can change settings."} />
      <Tabs items={visible.map((t) => ({ href: `/admin/settings?tab=${t}`, label: LABELS[t], active: t === tab }))} />
      <div className="mt-6 max-w-4xl">
        {tab === "scoring" && <Scoring ctx={ctx} canWrite={canWrite} />}
        {tab === "testing" && <Testing ctx={ctx} canWrite={canWrite} />}
        {tab === "ai" && <Ai ctx={ctx} canWrite={canWrite} />}
        {tab === "currency" && <Currency ctx={ctx} canWrite={canWrite} />}
        {tab === "notifications" && <Notifications ctx={ctx} canWrite={canWrite} />}
        {tab === "discovery" && <Discovery ctx={ctx} canWrite={canWrite} />}
        {tab === "storefront" && <Storefront ctx={ctx} canWrite={canWrite} />}
        {tab === "users" && can(ctx.role, "users:manage") && <Users ctx={ctx} />}
        {tab === "api-keys" && can(ctx.role, "apikeys:manage") && <ApiKeys ctx={ctx} />}
      </div>
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof pageContext>>;

function Save({ canWrite, label = "Save" }: { canWrite: boolean; label?: string }) {
  return canWrite ? <SubmitButton>{label}</SubmitButton> : <p className="text-xs text-dim">Read-only for your role.</p>;
}

async function Scoring({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const w = await getSetting(ctx, "scoring.weights");
  const total = Object.values(w).reduce((s, n) => s + n, 0);
  return (
    <Panel title="Scoring weights" subtitle={`Current total ${total}. Weights are normalised, so they need not add up to 100 — but 100 makes them read as percentages. Products are re-scored on the next scoring run.`}>
      <ActionForm action={saveSettingAction} className="space-y-4">
        <input type="hidden" name="key" value="scoring.weights" />
        <div className="grid gap-4 sm:grid-cols-3">
          {SCORING_FACTORS.map((f) => (
            <Field key={f} label={FACTOR_META[f].label} htmlFor={f} hint={FACTOR_META[f].description}>
              <Input id={f} name={f} type="number" min={0} max={100} step={1} defaultValue={w[f]} disabled={!canWrite} />
            </Field>
          ))}
        </div>
        <Save canWrite={canWrite} label="Save weights" />
      </ActionForm>
    </Panel>
  );
}

async function Testing({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const t = await getSetting(ctx, "testing.thresholds");
  const pct = (v: number) => Math.round(v * 10000) / 100;
  const fields: Array<[string, string, number, string?]> = [
    ["minDays", "Minimum test days", t.minDays],
    ["maxDays", "Maximum test days", t.maxDays],
    ["minPageViews", "Minimum page views for a verdict", t.minPageViews],
    ["winnerCtr", "Winner: min click-through %", pct(t.winner.minAffiliateCtr)],
    ["winnerConv", "Winner: min conversion %", pct(t.winner.minConversionRate)],
    ["winnerRoi", "Winner: min ROI % (when there is spend)", pct(t.winner.minRoi)],
    ["failCtr", "Failure: max click-through %", pct(t.failure.maxAffiliateCtr)],
    ["failConv", "Failure: max conversion %", pct(t.failure.maxConversionRate)],
    ["engagement", "Strong content engagement %", pct(t.engagement.strongRate)],
  ];
  return (
    <Panel title="Product testing thresholds" subtitle="Used to classify WINNER / PROMISING / FAILURE and to decide SCALE / TEST MORE / OPTIMIZE / CONTENT MORE / PAUSE / KILL. Don't copy defaults blindly — tune them to your traffic.">
      <ActionForm action={saveSettingAction} className="space-y-4">
        <input type="hidden" name="key" value="testing.thresholds" />
        <div className="grid gap-4 sm:grid-cols-3">
          {fields.map(([k, label, v]) => (
            <Field key={k} label={label} htmlFor={k}>
              <Input id={k} name={k} type="number" step="any" min={0} defaultValue={v} disabled={!canWrite} />
            </Field>
          ))}
        </div>
        <Save canWrite={canWrite} label="Save thresholds" />
      </ActionForm>
    </Panel>
  );
}

async function Ai({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const r = await getSetting(ctx, "ai.routing");
  return (
    <div className="space-y-6">
      <Callout title="Keys stay on the server">API keys are read from environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, OPENROUTER_API_KEY, LOCAL_AI_BASE_URL) and are never sent to the browser. Claude Opus 5 requests opt into server-side refusal fallbacks.</Callout>
      <Panel title="Providers">
        <ul className="space-y-2 text-sm">
          {providerStatus().map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3">
              <span className="text-haze">
                {p.label} <span className="text-dim">· defaults {DEFAULT_MODELS[p.id]?.fast} / {DEFAULT_MODELS[p.id]?.strong}</span>
              </span>
              <Badge tone={p.configured ? "good" : "neutral"}>{p.configured ? "configured" : `needs ${p.requirements.join(", ")}`}</Badge>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Model routing" subtitle="Cheap, fast models for simple tasks; strong models for research and strategy">
        <ActionForm action={saveSettingAction} className="space-y-4">
          <input type="hidden" name="key" value="ai.routing" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Provider" htmlFor="provider">
              <Select id="provider" name="provider" defaultValue={r.provider} disabled={!canWrite} options={["anthropic", "openai", "google", "openrouter", "local", "template"].map((p) => ({ value: p, label: p }))} />
            </Field>
            <Field label="Fast model" htmlFor="fastModel">
              <Input id="fastModel" name="fastModel" defaultValue={r.fastModel} disabled={!canWrite} />
            </Field>
            <Field label="Strong model" htmlFor="strongModel">
              <Input id="strongModel" name="strongModel" defaultValue={r.strongModel} disabled={!canWrite} />
            </Field>
            <Field label="Monthly budget (USD, 0 = unlimited)" htmlFor="monthlyBudgetUsd">
              <Input id="monthlyBudgetUsd" name="monthlyBudgetUsd" type="number" min={0} step="any" defaultValue={r.monthlyBudgetUsd} disabled={!canWrite} />
            </Field>
            <Field label="Response cache TTL (hours)" htmlFor="cacheTtlHours">
              <Input id="cacheTtlHours" name="cacheTtlHours" type="number" min={0} defaultValue={r.cacheTtlHours} disabled={!canWrite} />
            </Field>
          </div>
          <p className="eyebrow text-dim">Task tiers</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {AI_TASKS.map((task) => (
              <Field key={task} label={task.replace("_", " ")} htmlFor={`tier-${task}`}>
                <Select id={`tier-${task}`} name={`tier:${task}`} defaultValue={r.taskTiers[task] ?? "fast"} disabled={!canWrite} options={[{ value: "fast", label: "fast" }, { value: "strong", label: "strong" }]} />
              </Field>
            ))}
          </div>
          <Save canWrite={canWrite} label="Save routing" />
        </ActionForm>
      </Panel>
    </div>
  );
}

async function Currency({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const [c, m] = await Promise.all([getSetting(ctx, "currency"), getSetting(ctx, "markets")]);
  return (
    <div className="space-y-6">
      <Panel title="Currency" subtitle={`Units per 1 USD — MANUAL reference rates${c.ratesUpdatedAt ? `, updated ${formatRelative(new Date(c.ratesUpdatedAt))}` : " (defaults — update before relying on conversions)"}. Storefront prices converted from another currency are shown with “≈”.`}>
        <ActionForm action={saveSettingAction} className="space-y-4">
          <input type="hidden" name="key" value="currency" />
          <Field label="Dashboard display currency" htmlFor="display" className="max-w-xs">
            <Select id="display" name="display" defaultValue={c.display} disabled={!canWrite} options={CURRENCIES.map((x) => ({ value: x, label: x }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-6">
            {CURRENCIES.map((x) => (
              <Field key={x} label={x} htmlFor={`rate-${x}`}>
                <Input id={`rate-${x}`} name={`rate:${x}`} type="number" step="any" min={0} defaultValue={c.rates[x] ?? 1} disabled={!canWrite || x === "USD"} />
                {x === "USD" && <input type="hidden" name="rate:USD" value="1" />}
              </Field>
            ))}
          </div>
          <Save canWrite={canWrite} label="Save currency" />
        </ActionForm>
      </Panel>
      <Panel title="Markets" subtitle="Primary market drives shipping-availability scoring; nothing is hard-coded to one country">
        <ActionForm action={saveSettingAction} className="space-y-4">
          <input type="hidden" name="key" value="markets" />
          <Field label="Primary discovery market" htmlFor="primary" className="max-w-xs">
            <Select id="primary" name="primary" defaultValue={m.primary} disabled={!canWrite} options={MARKETS.map((x) => ({ value: x.code, label: x.name }))} />
          </Field>
          <fieldset className="flex flex-wrap gap-4">
            <legend className="mb-2 text-xs text-haze">Enabled markets</legend>
            {MARKETS.map((x) => (
              <label key={x.code} className="flex items-center gap-2 text-sm text-haze">
                <input type="checkbox" name="enabled" value={x.code} defaultChecked={m.enabled.includes(x.code)} disabled={!canWrite} className="accent-s1" /> {x.name}
              </label>
            ))}
          </fieldset>
          <Save canWrite={canWrite} label="Save markets" />
        </ActionForm>
      </Panel>
    </div>
  );
}

async function Notifications({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const n = await getSetting(ctx, "notifications");
  return (
    <Panel title="Notification channels" subtitle="Dashboard notifications are always on. External channels need credentials in the environment and are suppressed in DEMO_MODE.">
      <ActionForm action={saveSettingAction} className="space-y-4">
        <input type="hidden" name="key" value="notifications" />
        <label className="flex items-center gap-2 text-sm text-haze">
          <input type="checkbox" name="email" defaultChecked={n.email} disabled={!canWrite} className="accent-s1" /> Email alerts (Resend)
        </label>
        <label className="flex items-center gap-2 text-sm text-haze">
          <input type="checkbox" name="telegram" defaultChecked={n.telegram} disabled={!canWrite} className="accent-s1" /> Telegram alerts
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Alert email recipient" htmlFor="emailTo">
            <Input id="emailTo" name="emailTo" type="email" defaultValue={n.emailTo} disabled={!canWrite} placeholder="you@example.com" />
          </Field>
          <Field label="Spike multiplier (× trailing daily average)" htmlFor="trafficSpikeMultiplier">
            <Input id="trafficSpikeMultiplier" name="trafficSpikeMultiplier" type="number" step="0.1" min={1.2} max={20} defaultValue={n.trafficSpikeMultiplier} disabled={!canWrite} />
          </Field>
        </div>
        <Save canWrite={canWrite} />
      </ActionForm>
    </Panel>
  );
}

async function Discovery({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const d = await getSetting(ctx, "discovery");
  return (
    <Panel title="Discovery defaults" subtitle="Default strategy: problem-solving, demonstrable, small, easy to ship, non-regulated, healthy margin, broad audience">
      <ActionForm action={saveSettingAction} className="space-y-4">
        <input type="hidden" name="key" value="discovery" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Max price (USD)" htmlFor="maxPriceUsd">
            <Input id="maxPriceUsd" name="maxPriceUsd" type="number" min={1} defaultValue={d.maxPriceUsd} disabled={!canWrite} />
          </Field>
          <Field label="Min margin %" htmlFor="minMarginPct">
            <Input id="minMarginPct" name="minMarginPct" type="number" min={0} max={95} defaultValue={d.minMarginPct} disabled={!canWrite} />
          </Field>
          <Field label="Opportunity score threshold" htmlFor="minScoreToApprove">
            <Input id="minScoreToApprove" name="minScoreToApprove" type="number" min={0} max={100} defaultValue={d.minScoreToApprove} disabled={!canWrite} />
          </Field>
          <Field label="Default business model" htmlFor="defaultBusinessModel">
            <Select id="defaultBusinessModel" name="defaultBusinessModel" defaultValue={d.defaultBusinessModel} disabled={!canWrite} options={["AFFILIATE", "DROPSHIPPING", "SHOPIFY", "LANDING_PAGE"].map((x) => ({ value: x, label: x.toLowerCase().replace("_", " ") }))} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-haze">
          <input type="checkbox" name="excludeHighRisk" defaultChecked={d.excludeHighRisk} disabled={!canWrite} className="accent-s1" /> Exclude HIGH-risk products (medical, regulated, weapons, IP) from reports and opportunities
        </label>
        <label className="flex items-center gap-2 text-sm text-haze">
          <input type="checkbox" name="autoScoreNewProducts" defaultChecked={d.autoScoreNewProducts} disabled={!canWrite} className="accent-s1" /> Score new products automatically
        </label>
        <Save canWrite={canWrite} />
      </ActionForm>
    </Panel>
  );
}

async function Storefront({ ctx, canWrite }: { ctx: Ctx; canWrite: boolean }) {
  const s = await getSetting(ctx, "storefront");
  return (
    <Panel title="Storefront & compliance copy" subtitle="Shown on every product page, landing page and in the footer">
      <ActionForm action={saveSettingAction} className="space-y-4">
        <input type="hidden" name="key" value="storefront" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name" htmlFor="name">
            <Input id="name" name="name" defaultValue={s.name} maxLength={60} disabled={!canWrite} />
          </Field>
          <Field label="Contact email" htmlFor="contactEmail">
            <Input id="contactEmail" name="contactEmail" type="email" defaultValue={s.contactEmail} disabled={!canWrite} />
          </Field>
        </div>
        <Field label="Affiliate disclosure" htmlFor="affiliateDisclosure">
          <Textarea id="affiliateDisclosure" name="affiliateDisclosure" rows={3} defaultValue={s.affiliateDisclosure} disabled={!canWrite} />
        </Field>
        <Field label="Returns summary" htmlFor="returnsSummary">
          <Textarea id="returnsSummary" name="returnsSummary" rows={2} defaultValue={s.returnsSummary} disabled={!canWrite} />
        </Field>
        <Field label="Shipping summary" htmlFor="shippingSummary">
          <Textarea id="shippingSummary" name="shippingSummary" rows={2} defaultValue={s.shippingSummary} disabled={!canWrite} />
        </Field>
        <Save canWrite={canWrite} />
      </ActionForm>
    </Panel>
  );
}

async function Users({ ctx }: { ctx: Ctx }) {
  const rows = await ctx.db.select().from(users).where(eq(users.organizationId, ctx.orgId)).orderBy(users.createdAt);
  return (
    <div className="space-y-6">
      <Panel title="Team" subtitle="Admin: everything · Operator: products, agents, content, campaigns · Viewer: read-only" bodyClassName="p-0">
        <Table minWidth={820}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last login</Th>
              <Th align="end" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <Td>
                  <p className="text-fog">{u.name}</p>
                  <p className="text-xs text-dim">{u.email}</p>
                </Td>
                <Td>
                  {u.id === ctx.userId ? (
                    <Badge tone="info">{u.role} (you)</Badge>
                  ) : (
                    <ActionForm action={updateUserAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="op" value="role" />
                      <Select name="role" defaultValue={u.role} className="h-8 w-32 text-xs" aria-label="Role" options={USER_ROLES.map((r) => ({ value: r, label: r }))} />
                      <SubmitButton size="sm" variant="ghost">
                        Set
                      </SubmitButton>
                    </ActionForm>
                  )}
                </Td>
                <Td>
                  <Badge tone={u.disabled ? "critical" : "good"}>{u.disabled ? "disabled" : "active"}</Badge>
                </Td>
                <Td className="text-xs">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : "never"}</Td>
                <Td align="end">
                  {u.id !== ctx.userId && (
                    <ActionForm action={updateUserAction}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="op" value={u.disabled ? "enable" : "disable"} />
                      <SubmitButton size="sm" variant={u.disabled ? "secondary" : "danger"} confirm={u.disabled ? undefined : `Disable ${u.email}? Their sessions end immediately.`}>
                        {u.disabled ? "Enable" : "Disable"}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Add a user">
        <ActionForm action={createUserAction} className="grid gap-3 sm:grid-cols-2" resetOnSuccess>
          <Field label="Name" htmlFor="uname">
            <Input id="uname" name="name" required maxLength={120} />
          </Field>
          <Field label="Email" htmlFor="uemail">
            <Input id="uemail" name="email" type="email" required />
          </Field>
          <Field label="Temporary password (≥ 10 chars)" htmlFor="upass">
            <Input id="upass" name="password" type="password" required minLength={10} autoComplete="new-password" />
          </Field>
          <Field label="Role" htmlFor="urole">
            <Select id="urole" name="role" defaultValue="operator" options={USER_ROLES.map((r) => ({ value: r, label: r }))} />
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton>Add user</SubmitButton>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}

async function ApiKeys({ ctx }: { ctx: Ctx }) {
  const rows = await ctx.db.select().from(apiKeys).where(eq(apiKeys.organizationId, ctx.orgId)).orderBy(desc(apiKeys.createdAt));
  return (
    <div className="space-y-6">
      <Callout title="REST API">
        Send <Mono>Authorization: Bearer forge_…</Mono> to <Mono>/api/v1/*</Mono>. Keys are stored as SHA-256 hashes, carry a role, and are shown only once at creation. See docs/API.md.
      </Callout>
      <Panel title="Keys" bodyClassName="p-0">
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th>Role</Th>
              <Th>Last used</Th>
              <Th>Status</Th>
              <Th align="end" />
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <tr key={k.id}>
                <Td className="text-fog">{k.name}</Td>
                <Td>
                  <Mono>forge_{k.keyPrefix}_…</Mono>
                </Td>
                <Td className="text-xs">{k.role}</Td>
                <Td className="text-xs">{k.lastUsedAt ? formatRelative(k.lastUsedAt) : "never"}</Td>
                <Td>
                  <Badge tone={k.revokedAt ? "critical" : "good"}>{k.revokedAt ? "revoked" : "active"}</Badge>
                </Td>
                <Td align="end">
                  {!k.revokedAt && (
                    <ActionForm action={apiKeyAction}>
                      <input type="hidden" name="op" value="revoke" />
                      <input type="hidden" name="id" value={k.id} />
                      <SubmitButton size="sm" variant="danger" confirm="Revoke this key? Integrations using it stop working.">
                        Revoke
                      </SubmitButton>
                    </ActionForm>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
      <Panel title="Create a key">
        <ActionForm action={apiKeyAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="op" value="create" />
          <Field label="Name" htmlFor="kname" className="w-64">
            <Input id="kname" name="name" required maxLength={80} placeholder="Zapier / n8n / BI export" />
          </Field>
          <Field label="Role" htmlFor="krole" className="w-40">
            <Select id="krole" name="role" defaultValue="viewer" options={USER_ROLES.map((r) => ({ value: r, label: r }))} />
          </Field>
          <SubmitButton>Create key</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
