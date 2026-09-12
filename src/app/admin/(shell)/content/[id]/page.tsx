import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { CONTENT_STATUSES } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatNumber, isoDate } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { contentAssets, contentMetrics, products } from "@/server/db/schema";
import { getContent, trackingUrlFor } from "@/server/services/content";
import { CHANNELS } from "@/server/integrations/social";
import { isDemoMode } from "@/server/env";
import { Badge, Callout, DemoTag, EngineBadge, Field, Input, Mono, PageHeader, Panel, ProvenanceBadge, Select, Table, Td, Textarea, Th } from "@/components/admin/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/admin/forms";
import { addAssetAction, publishContentAction, recordMetricsAction, updateContentAction } from "../../../actions/growth";
import { statusTone } from "../page";

export const metadata = { title: "Content item" };

const BEAT_COLORS: Record<string, string> = { HOOK: "bg-b250", PROBLEM: "bg-b350", DEMONSTRATION: "bg-b450", PAYOFF: "bg-b550", CTA: "bg-b550" };

export default async function ContentDetail({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("content:read");
  const { id } = await params;
  let item: Awaited<ReturnType<typeof getContent>>;
  try {
    item = await getContent(ctx, id);
  } catch {
    notFound();
  }
  const [[product], metrics, assets, tracked] = await Promise.all([
    item.productId ? ctx.db.select({ id: products.id, title: products.title }).from(products).where(eq(products.id, item.productId)).limit(1) : Promise.resolve([]),
    ctx.db.select().from(contentMetrics).where(eq(contentMetrics.contentId, id)).orderBy(desc(contentMetrics.date)).limit(30),
    ctx.db.select().from(contentAssets).where(eq(contentAssets.contentId, id)).orderBy(desc(contentAssets.createdAt)),
    trackingUrlFor(ctx, item),
  ]);
  const channel = CHANNELS.find((c) => c.platform === item.platform);
  const canWrite = can(ctx.role, "content:write");
  const total = item.script?.length ? Math.max(...item.script.map((b) => b.to)) : 0;

  return (
    <>
      <div className="mb-4 text-xs text-dim">
        <Link href="/admin/content" className="hover:text-haze">
          Content
        </Link>{" "}
        / <span className="text-haze">{item.utmContent}</span>
      </div>
      <PageHeader
        title={item.hook ?? item.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(item.status)}>{item.status.replace("_", " ").toLowerCase()}</Badge>
            {item.platform.toLowerCase()} · {item.contentType.replace(/_/g, " ").toLowerCase()} · angle {item.angle?.replace(/_/g, " ").toLowerCase() ?? "—"} ·{" "}
            {product && (
              <Link href={`/admin/products/${product.id}?tab=content`} className="text-fog underline decoration-edge-2 underline-offset-2">
                {product.title}
              </Link>
            )}
            <EngineBadge method={item.generationMethod} model={item.model} />
            {item.isDemo && <DemoTag />}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {item.script?.length ? (
            <Panel title="Script" subtitle={`${total}s · Hook 0–3s → Problem → Demonstration → Payoff → CTA`}>
              <div className="mb-5 flex h-2 gap-[2px] overflow-hidden rounded" aria-hidden>
                {item.script.map((b) => (
                  <div key={b.label} className={BEAT_COLORS[b.label] ?? "bg-b450"} style={{ width: `${((b.to - b.from) / total) * 100}%` }} />
                ))}
              </div>
              <ol className="space-y-4">
                {item.script.map((b) => (
                  <li key={b.label} className="grid grid-cols-[88px_minmax(0,1fr)] gap-4">
                    <div>
                      <p className="text-xs font-medium text-fog">{b.label}</p>
                      <p className="tabular text-[11px] text-dim">
                        {b.from}–{b.to}s
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-fog">{b.line}</p>
                      <p className="mt-1 text-xs text-dim">Visual: {b.visual}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          ) : (
            item.body && (
              <Panel title="Post">
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-haze">{item.body}</pre>
              </Panel>
            )
          )}
          <Panel title="Caption & distribution">
            <p className="whitespace-pre-line text-sm leading-relaxed text-fog">{item.caption}</p>
            {item.hashtags.length > 0 && <p className="mt-2 text-sm text-s1">{item.hashtags.join(" ")}</p>}
            {item.sponsoredDisclosure && (
              <Callout className="mt-4" tone="warning" title="Disclosure required">
                {item.sponsoredDisclosure}
              </Callout>
            )}
            {tracked && (
              <div className="mt-4">
                <p className="eyebrow mb-1.5 text-dim">Tracked link</p>
                <div className="flex items-center gap-2">
                  <Mono className="min-w-0 flex-1 truncate">{tracked}</Mono>
                  <CopyButton value={tracked} />
                </div>
              </div>
            )}
          </Panel>
          <Panel title="Performance" subtitle="Platform metrics per day — synced from APIs when connected, otherwise entered here" bodyClassName="p-0">
            {metrics.length ? (
              <Table minWidth={760}>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th align="end">Views</Th>
                    <Th align="end">Likes</Th>
                    <Th align="end">Comments</Th>
                    <Th align="end">Shares</Th>
                    <Th align="end">Saves</Th>
                    <Th align="end">Clicks</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((m) => (
                    <tr key={m.id}>
                      <Td className="text-xs">{m.date}</Td>
                      <Td align="end">{formatNumber(m.views)}</Td>
                      <Td align="end">{formatNumber(m.likes)}</Td>
                      <Td align="end">{formatNumber(m.comments)}</Td>
                      <Td align="end">{formatNumber(m.shares)}</Td>
                      <Td align="end">{formatNumber(m.saves)}</Td>
                      <Td align="end">{formatNumber(m.clicks)}</Td>
                      <Td>
                        <ProvenanceBadge p={m.provenance} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <p className="p-5 text-sm text-dim">No metrics recorded yet.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          {canWrite && (
            <Panel title="Status & schedule">
              <ActionForm action={updateContentAction} className="space-y-3">
                <input type="hidden" name="id" value={item.id} />
                <Field label="Status" htmlFor="status">
                  <Select id="status" name="status" defaultValue={item.status} options={CONTENT_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() }))} />
                </Field>
                <Field label="Publishing date" htmlFor="scheduledAt">
                  <Input id="scheduledAt" name="scheduledAt" type="date" defaultValue={item.scheduledAt ? isoDate(item.scheduledAt) : ""} />
                </Field>
                <Field label="Hook" htmlFor="hook">
                  <Input id="hook" name="hook" defaultValue={item.hook ?? ""} maxLength={300} />
                </Field>
                <Field label="Caption" htmlFor="caption">
                  <Textarea id="caption" name="caption" rows={4} defaultValue={item.caption ?? ""} maxLength={2200} />
                </Field>
                <Field label="Published post URL" htmlFor="externalUrl">
                  <Input id="externalUrl" name="externalUrl" defaultValue={item.externalUrl ?? ""} placeholder="https://…" />
                </Field>
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          <Panel title={`Publish to ${channel?.label ?? item.platform}`}>
            {channel?.mode === "direct" && channel.isConfigured() ? (
              <>
                {isDemoMode() && <p className="mb-3 text-xs text-warning">DEMO_MODE is on — publishing is blocked.</p>}
                <ActionForm action={publishContentAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <SubmitButton size="sm" confirm={`Publish this to ${channel.label} now?`}>
                    Publish via {channel.api}
                  </SubmitButton>
                </ActionForm>
              </>
            ) : (
              <div className="text-xs text-haze">
                <p className="mb-2">{channel?.mode === "package" ? "Direct publishing isn't available for this platform without an audited app — publish the package manually." : "Not connected. Requires:"}</p>
                <ul className="list-disc space-y-1 ps-4 text-dim">
                  {channel?.requirements.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <div className="mt-3 flex gap-2">
                  {(["markdown", "json"] as const).map((f) => (
                    <a key={f} href={`/api/v1/content/export?ids=${item.id}&format=${f}`} className="rounded border border-edge-2 px-2 py-1 text-fog hover:bg-panel-2">
                      Export {f}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </Panel>
          {canWrite && (
            <Panel title="Record platform metrics" subtitle="Stored as MANUAL provenance">
              <ActionForm action={recordMetricsAction} className="grid grid-cols-2 gap-2" resetOnSuccess>
                <input type="hidden" name="id" value={item.id} />
                <Field label="Date" htmlFor="m-date" className="col-span-2">
                  <Input id="m-date" name="date" type="date" required defaultValue={isoDate(new Date())} />
                </Field>
                {["views", "likes", "comments", "shares", "saves", "clicks", "profileVisits", "cost"].map((k) => (
                  <Field key={k} label={k} htmlFor={`m-${k}`}>
                    <Input id={`m-${k}`} name={k} inputMode="numeric" defaultValue="0" />
                  </Field>
                ))}
                <SubmitButton size="sm" className="col-span-2">
                  Record
                </SubmitButton>
              </ActionForm>
            </Panel>
          )}
          <Panel title="Assets">
            {assets.length ? (
              <ul className="mb-3 space-y-1 text-xs">
                {assets.map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge>{a.kind.toLowerCase()}</Badge>
                    <a href={a.url ?? "#"} target="_blank" rel="noopener noreferrer" className="truncate text-haze underline decoration-edge-2 underline-offset-2">
                      {a.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-xs text-dim">No assets attached.</p>
            )}
            {canWrite && (
              <ActionForm action={addAssetAction} className="space-y-2" resetOnSuccess>
                <input type="hidden" name="contentId" value={item.id} />
                <Select name="kind" aria-label="Asset kind" options={["IMAGE", "VIDEO", "UGC", "THUMBNAIL", "CREATIVE_VARIANT"].map((k) => ({ value: k, label: k.replace("_", " ").toLowerCase() }))} />
                <Input name="url" type="url" required placeholder="https://cdn…/asset.jpg" />
                <SubmitButton size="sm" variant="secondary">
                  Attach hosted asset
                </SubmitButton>
              </ActionForm>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
