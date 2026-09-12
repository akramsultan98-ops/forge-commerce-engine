import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { ACTION_PERMISSION, type AffiliateAction } from "@/domain/affiliate-products";
import { formatMoney } from "@/domain/money";
import { can } from "@/lib/rbac";
import { formatDate, formatNumber, formatPercent, formatRelative } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { auditLogs } from "@/server/db/schema";
import { getAffiliateProduct } from "@/server/services/affiliate-products";
import { affiliateTracking, listingClickSources } from "@/server/services/affiliate-monitoring";
import { listCategories } from "@/server/services/catalog";
import { Badge, ButtonLink, Callout, DemoTag, Field, Input, KeyValue, Mono, PageHeader, Panel, ProvenanceBadge, Select, Textarea } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { AvailabilityBadge, FreshnessBadge, ListingStatusBadge } from "@/components/admin/listings";
import { ProductVisual } from "@/components/ProductVisual";
import { listingEditAction, listingTransitionAction } from "../../../actions/affiliate";

const ACTION_UI: Record<AffiliateAction, { label: string; variant: "primary" | "secondary" | "ghost" | "danger"; confirm?: string }> = {
  submit: { label: "Submit for review", variant: "secondary" },
  approve: { label: "Approve", variant: "primary" },
  reject: { label: "Reject", variant: "danger" },
  publish: { label: "Publish to storefront", variant: "primary", confirm: "Publish this listing? Its storefront page and tracked link are created from the network data." },
  unpublish: { label: "Unpublish", variant: "secondary", confirm: "Take this product off the storefront? Its tracked link is paused." },
  archive: { label: "Archive", variant: "ghost", confirm: "Archive this listing? A published product is taken off the storefront." },
  restore: { label: "Restore to review", variant: "secondary" },
};

const when = (d: Date | null) => (d ? formatDate(d, "en", { dateStyle: "medium", timeStyle: "short" }) : "—");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await pageContext("affiliate:read");
    return { title: (await getAffiliateProduct(ctx, id)).title };
  } catch {
    return { title: "Network listing" };
  }
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await pageContext("affiliate:read");
  const { id } = await params;
  let l: Awaited<ReturnType<typeof getAffiliateProduct>>;
  try {
    l = await getAffiliateProduct(ctx, id);
  } catch {
    notFound();
  }
  const [cats, tracking, sources, history] = await Promise.all([
    listCategories(ctx),
    affiliateTracking(ctx, { affiliateProductId: l.id, days: 30 }),
    listingClickSources(ctx, l.id, 30),
    ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, ctx.orgId), eq(auditLogs.entityType, "affiliate_product"), eq(auditLogs.entityId, l.id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(15),
  ]);
  const tr = tracking.items[0];
  const canEdit = can(ctx.role, "affiliate:review");
  const actions = l.allowedActions.filter((a) => can(ctx.role, ACTION_PERMISSION[a]));
  const category = cats.find((c) => c.id === l.categoryId);
  const network = l.network.replace(/_/g, " ").toLowerCase();

  return (
    <>
      <div className="mb-4 text-xs text-dim">
        <Link href="/admin/affiliate-products" className="hover:text-haze">
          Network listings
        </Link>{" "}
        / <span className="text-haze">{l.externalId}</span>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {l.title} <ListingStatusBadge status={l.status} /> {l.isDemo && <DemoTag />}
          </span>
        }
        description={`${network} · ${l.marketplace} · ${l.externalIdType} ${l.externalId}${l.merchant ? ` · sold by ${l.merchant}` : ""}`}
        actions={
          <>
            {l.productUrl && (
              <ButtonLink href={l.productUrl} external size="sm" variant="ghost">
                On {l.marketplace} <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </ButtonLink>
            )}
            {l.storefront && (
              <ButtonLink href={`/admin/products/${l.storefront.productId}`} size="sm" variant="secondary">
                Storefront product
              </ButtonLink>
            )}
            {l.storefront?.visible && (
              <ButtonLink href={l.storefront.path} external size="sm" variant="ghost">
                View page <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </ButtonLink>
            )}
          </>
        }
      />

      {l.lastSyncError && (
        <Callout tone="critical" className="mb-4" title="The last refresh or check failed">
          {l.lastSyncError}
        </Callout>
      )}
      {!l.fresh && (
        <Callout tone="warning" className="mb-4" title="Network data is stale">
          Fetched {l.dataAgeHours === null ? "never" : `${Math.round(l.dataAgeHours)} h ago`}; {network} data may be shown for at most {l.maxDataAgeHours} h.{" "}
          {l.status === "PUBLISHED" ? "The storefront stopped showing this product until the next successful refresh." : "Refresh it before publishing."}
        </Callout>
      )}
      {(l.status === "REVIEW" || l.status === "APPROVED") && l.publishBlockers.length > 0 && (
        <Callout className="mb-4" title="Before this listing can be published">
          <ul className="list-disc space-y-1 ps-5 text-xs">
            {l.publishBlockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          {actions.length > 0 && (
            <Panel title="Review decision" subtitle="Approving and publishing are always done by a person — never by an API key">
              <ActionForm action={listingTransitionAction} className="space-y-3">
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="revision" value={l.revision} />
                <Field label="Note (optional — saved with the decision)" htmlFor="note">
                  <Textarea id="note" name="note" rows={2} maxLength={2000} />
                </Field>
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <SubmitButton key={a} name="action" value={a} variant={ACTION_UI[a].variant} size="sm" confirm={ACTION_UI[a].confirm}>
                      {ACTION_UI[a].label}
                    </SubmitButton>
                  ))}
                </div>
              </ActionForm>
              {l.reviewNote && <p className="mt-3 text-xs text-dim">Last note: {l.reviewNote}</p>}
            </Panel>
          )}

          <Panel title="Network data" subtitle={`Read-only — supplied by ${network} and updated on every refresh`}>
            <div className="flex flex-col gap-5 sm:flex-row">
              <ProductVisual title={l.title} slug={l.id} imageUrl={l.imageUrls[0] ?? null} categoryName={l.category} size="md" className="h-36 w-36 shrink-0 rounded-md" />
              <KeyValue
                className="flex-1"
                items={[
                  { k: "Price", v: l.price !== null && l.currency ? `${formatMoney(l.price, l.currency)}${l.priceDisplay ? ` (${l.priceDisplay})` : ""}` : "not supplied" },
                  {
                    k: "Availability",
                    v: (
                      <span className="flex flex-wrap items-center gap-2">
                        <AvailabilityBadge availability={l.availability} />
                        {l.availabilityMessage && <span className="text-xs text-dim">{l.availabilityMessage}</span>}
                      </span>
                    ),
                  },
                  { k: "Brand", v: l.brand ?? "—" },
                  { k: "Network category", v: l.categoryPath.length ? l.categoryPath.join(" › ") : (l.category ?? "—") },
                  { k: "Commission (network)", v: l.commissionRate !== null ? `${l.commissionRate}%` : "not supplied" },
                  { k: "Rating", v: l.reviewSource ? `${l.rating ?? "—"} / 5 · ${formatNumber(l.reviewCount)} reviews (${l.reviewSource})` : "not supplied by the network" },
                  {
                    k: "Data",
                    v: (
                      <span className="flex flex-wrap items-center gap-2">
                        <FreshnessBadge fresh={l.fresh} ageHours={l.dataAgeHours} maxHours={l.maxDataAgeHours} />
                        <ProvenanceBadge p={l.provenance} />
                        <span className="text-xs text-dim">
                          via {l.ingestSource} · {when(l.dataFetchedAt)}
                        </span>
                      </span>
                    ),
                  },
                  { k: "Images", v: `${l.imageUrls.length} — links to network-hosted files, never copied` },
                ]}
              />
            </div>
            {l.features.length > 0 && (
              <>
                <p className="eyebrow mb-2 mt-6 text-dim">Features</p>
                <ul className="list-disc space-y-1 ps-5 text-sm text-haze">
                  {l.features.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </>
            )}
            {l.description && <p className="mt-5 text-sm leading-relaxed text-haze">{l.description}</p>}
            <div className="mt-5 space-y-1.5 text-xs text-dim">
              <p>
                Product URL: <Mono>{l.productUrl ?? "—"}</Mono>
              </p>
              <p>
                Affiliate URL: <Mono>{l.affiliateUrl ?? "—"}</Mono>
              </p>
            </div>
          </Panel>

          <Panel title="Score" subtitle="Recorded by an automation or an operator — always with its provenance">
            {l.score !== null ? (
              <div className="space-y-3">
                <p className="flex flex-wrap items-center gap-3">
                  <span className="text-3xl font-semibold text-fog">{Math.round(l.score)}</span>
                  <span className="text-xs text-dim">/ 100</span>
                  <ProvenanceBadge p={l.scoreProvenance} />
                  <span className="text-xs text-dim">
                    {l.scoreSource} · {l.scoredAt ? formatRelative(l.scoredAt) : ""}
                  </span>
                </p>
                {l.scoreReasons.length > 0 && (
                  <ul className="list-disc space-y-1 ps-5 text-sm text-haze">
                    {l.scoreReasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-dim">Not scored yet. Automations record scores with POST /api/v1/affiliate/products/{"{id}"}/score.</p>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="FORGE fields" subtitle="Yours to edit — never overwritten by a refresh">
            {canEdit ? (
              <ActionForm action={listingEditAction} className="space-y-3">
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="revision" value={l.revision} />
                <Field label="Storefront category" htmlFor="categoryId" hint={!l.categoryId && l.category ? `Empty = use a FORGE category named like “${l.category}”, if one exists.` : undefined}>
                  <Select id="categoryId" name="categoryId" defaultValue={l.categoryId ?? ""} options={[{ value: "", label: "—" }, ...cats.map((c) => ({ value: c.id, label: c.name }))]} />
                </Field>
                <Field label="Summary (FORGE's own words)" htmlFor="summary" hint={l.description ? "Shown instead of the network's description." : "Shown as the description — the network supplied none."}>
                  <Textarea id="summary" name="summary" rows={4} maxLength={2000} defaultValue={l.summary ?? ""} />
                </Field>
                <Field label="Problem it solves" htmlFor="problemSolved">
                  <Input id="problemSolved" name="problemSolved" maxLength={300} defaultValue={l.problemSolved ?? ""} />
                </Field>
                <Field label="Target audience" htmlFor="targetAudience">
                  <Input id="targetAudience" name="targetAudience" maxLength={300} defaultValue={l.targetAudience ?? ""} />
                </Field>
                <Field label="Tags (one per line)" htmlFor="tags">
                  <Textarea id="tags" name="tags" rows={2} defaultValue={l.tags.join("\n")} />
                </Field>
                <Field label="Expected commission %" htmlFor="expectedCommissionRate" hint="From the network's rate card — for scoring and reports, never shown to shoppers.">
                  <Input id="expectedCommissionRate" name="expectedCommissionRate" inputMode="decimal" defaultValue={l.expectedCommissionRate ?? ""} />
                </Field>
                <div className="flex items-center gap-3 pt-1">
                  <SubmitButton pendingText="Saving…">Save FORGE fields</SubmitButton>
                  <span className="text-[11px] text-dim">revision {l.revision}</span>
                </div>
              </ActionForm>
            ) : (
              <KeyValue
                items={[
                  { k: "Category", v: category?.name ?? "—" },
                  { k: "Summary", v: l.summary ?? "—" },
                  { k: "Problem it solves", v: l.problemSolved ?? "—" },
                  { k: "Target audience", v: l.targetAudience ?? "—" },
                ]}
              />
            )}
          </Panel>

          <Panel title="Storefront">
            {l.storefront ? (
              <KeyValue
                items={[
                  {
                    k: "Product",
                    v: (
                      <Link href={`/admin/products/${l.storefront.productId}`} className="text-fog hover:underline">
                        {l.storefront.slug}
                      </Link>
                    ),
                  },
                  { k: "On the storefront", v: <Badge tone={l.storefront.visible ? "good" : "neutral"}>{l.storefront.visible ? "visible" : "hidden"}</Badge> },
                  { k: "Network data expires", v: l.storefront.expiresAt ? when(l.storefront.expiresAt) : "no limit" },
                  {
                    k: "Tracked link",
                    v: l.storefront.link ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <Mono>/r/{l.storefront.link.code}</Mono>
                        <Badge>{l.storefront.link.status.toLowerCase()}</Badge>
                      </span>
                    ) : (
                      "—"
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-dim">Not on the storefront. Publishing an approved listing creates its product page and tracked link.</p>
            )}
          </Panel>

          <Panel title="Tracking · last 30 days">
            <KeyValue
              items={[
                { k: "Product page views", v: formatNumber(tr?.views ?? 0) },
                { k: "Outbound clicks", v: formatNumber(tr?.outboundClicks ?? 0) },
                { k: "Click-through", v: tr?.clickThroughRate != null ? formatPercent(tr.clickThroughRate) : "—" },
                { k: "Redirect fallbacks", v: formatNumber(tr?.redirectFallbacks ?? 0) },
                { k: "Reported conversions", v: formatNumber(tr?.conversions ?? 0) },
                {
                  k: "Reported commission",
                  v:
                    Object.entries(tr?.commission ?? {})
                      .map(([c, a]) => formatMoney(a, c))
                      .join(" · ") || "none reported",
                },
              ]}
            />
            {sources.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-haze">
                {sources.map((s) => (
                  <li key={`${s.source}:${s.campaign ?? ""}`} className="flex justify-between gap-3">
                    <span className="truncate">
                      {s.source}
                      {s.campaign ? ` / ${s.campaign}` : ""}
                    </span>
                    <span className="tabular">{s.clicks}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-dim">
              Commission appears only when the network reports it. Amazon sends no postbacks — import Associates earnings reports with POST /api/v1/affiliate/conversions.
            </p>
          </Panel>

          <Panel title="History">
            {history.length ? (
              <ul className="space-y-2 text-xs">
                {history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-3">
                    <span className="text-haze">
                      {h.action.replace("affiliate_product.", "")}
                      {typeof h.meta.note === "string" && h.meta.note ? ` — ${h.meta.note}` : ""}
                      <span className="text-dim"> · {h.actor}</span>
                    </span>
                    <span className="shrink-0 text-dim">{formatRelative(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-dim">No decisions recorded yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
