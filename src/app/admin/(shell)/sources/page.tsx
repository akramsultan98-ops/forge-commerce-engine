import { Database } from "lucide-react";
import { can } from "@/lib/rbac";
import { formatRelative } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { integrationOverview } from "@/server/integrations/status";
import { Badge, Callout, EmptyState, Field, Input, PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { enqueueJobAction } from "../../actions/products";
import { sourceConfigAction } from "../../actions/system";

export const metadata = { title: "Sources" };

type FieldDef = { key: string; label: string; kind: "config" | "cred"; secret?: boolean; placeholder?: string };
const FIELDS: Record<string, FieldDef[]> = {
  AFFILIATE_NETWORK: [
    { key: "feedUrl", label: "Product feed URL (https)", kind: "config", placeholder: "https://productdata.awin.com/datafeed/download/apikey/…" },
    { key: "networkName", label: "Network name", kind: "config", placeholder: "Awin" },
    { key: "defaultCommission", label: "Default commission %", kind: "config", placeholder: "8" },
  ],
  CJ: [{ key: "apiKey", label: "CJ API key", kind: "cred", secret: true }],
  ALIEXPRESS: [
    { key: "appKey", label: "App key", kind: "cred" },
    { key: "appSecret", label: "App secret", kind: "cred", secret: true },
  ],
  AMAZON: [
    { key: "accessKey", label: "PA-API access key", kind: "cred" },
    { key: "secretKey", label: "PA-API secret key", kind: "cred", secret: true },
    { key: "partnerTag", label: "Partner tag", kind: "cred" },
  ],
  TIKTOK_SHOP: [
    { key: "appKey", label: "App key", kind: "cred" },
    { key: "appSecret", label: "App secret", kind: "cred", secret: true },
    { key: "accessToken", label: "Access token", kind: "cred", secret: true },
  ],
  SOCIAL_TREND: [{ key: "accessToken", label: "Access token", kind: "cred", secret: true }],
};

export default async function SourcesPage() {
  const ctx = await pageContext("settings:read");
  const overview = await integrationOverview(ctx);
  const canManage = can(ctx.role, "integrations:manage");
  const canRun = can(ctx.role, "agents:run");

  return (
    <>
      <PageHeader
        eyebrow="Money & data"
        title="Discovery sources"
        description="Each source is an adapter behind one interface (discover / signals). Implemented adapters run today; interface adapters document exactly what access they need — FORGE never fakes a connection or scrapes against platform terms."
        actions={
          canRun && (
            <>
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="trend_refresh" />
                <SubmitButton variant="secondary" pendingText="Queuing…">
                  Refresh trend signals
                </SubmitButton>
              </ActionForm>
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="product_discovery" />
                <SubmitButton pendingText="Queuing…">Run discovery</SubmitButton>
              </ActionForm>
            </>
          )
        }
      />
      <Callout className="mb-6" title="Credentials are encrypted at rest (AES-256-GCM) and never sent to the browser">
        Saved values are never displayed again — enter a new value to replace one.
      </Callout>
      {overview.sources.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {overview.sources.map((s) => {
            const a = s.adapter;
            const fields = FIELDS[s.adapter?.key ?? ""] ?? [];
            return (
              <Panel
                key={s.id}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {a?.label ?? s.name}
                    <Badge tone={s.status === "CONNECTED" ? "good" : s.status === "ERROR" ? "critical" : s.status === "DEMO" ? "warning" : "neutral"}>{s.status.replace("_", " ").toLowerCase()}</Badge>
                    <Badge tone={a?.implementation === "implemented" ? "info" : "neutral"}>{a?.implementation === "implemented" ? "implemented" : "interface"}</Badge>
                  </span>
                }
                subtitle={`${a?.kind ?? ""} · ${a?.officialApi ? "official API / feed" : "no public API"}${s.lastRunAt ? ` · last run ${formatRelative(s.lastRunAt)} (${s.lastResultCount ?? 0} found)` : ""}`}
              >
                {a?.notes && <p className="mb-3 text-xs leading-relaxed text-haze">{a.notes}</p>}
                {a && a.requirements.length > 0 && (
                  <ul className="mb-3 list-disc space-y-1 ps-4 text-xs text-dim">
                    {a.requirements.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                {s.lastError && <p className="mb-3 text-xs text-[#ff9b9b]">Last error: {s.lastError}</p>}
                {a?.docsUrl?.startsWith("http") && (
                  <a href={a.docsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-fog underline decoration-edge-2 underline-offset-4">
                    Official documentation ↗
                  </a>
                )}
                {canManage && (fields.length > 0 || a?.implementation === "implemented") && a?.key !== "DEMO" && a?.key !== "MANUAL_IMPORT" && (
                  <ActionForm action={sourceConfigAction} className="mt-4 space-y-2 border-t border-edge pt-4">
                    <input type="hidden" name="id" value={s.id} />
                    {fields.map((f) => (
                      <Field key={f.key} label={`${f.label}${f.kind === "cred" && s.hasCredentials ? " (saved — leave blank to keep)" : ""}`} htmlFor={`${s.id}-${f.key}`}>
                        <Input
                          id={`${s.id}-${f.key}`}
                          name={`${f.kind}:${f.key}`}
                          type={f.secret ? "password" : "text"}
                          autoComplete="off"
                          placeholder={f.placeholder}
                          defaultValue={f.kind === "config" ? String((s.config as Record<string, unknown>)?.[f.key] ?? "") : ""}
                        />
                      </Field>
                    ))}
                    <label className="flex items-center gap-2 text-sm text-haze">
                      <input type="checkbox" name="enabled" defaultChecked={s.enabled} className="accent-s1" /> Enabled for scheduled discovery
                    </label>
                    <SubmitButton size="sm">Save</SubmitButton>
                  </ActionForm>
                )}
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Database} title="No sources" />
      )}
    </>
  );
}
