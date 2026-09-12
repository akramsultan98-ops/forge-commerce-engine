import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ExternalLink, FlaskConical, Gauge, Rocket, WandSparkles } from "lucide-react";
import { CONTENT_ANGLES, PLATFORMS, PRODUCT_STATUSES, PUBLIC_PRODUCT_STATUSES, LANDING_TEMPLATES } from "@/lib/constants";
import { TEMPLATE_LAYOUTS } from "@/lib/landing-sections";
import { can } from "@/lib/rbac";
import { formatDate, formatNumber, formatPercent, formatRelative, round } from "@/lib/utils";
import { formatMoney } from "@/domain/money";
import { FACTOR_META, SCORING_FACTORS } from "@/domain/scoring";
import { buildUtmUrl, PLATFORM_UTM_SOURCE } from "@/domain/utm";
import { pageContext } from "@/server/auth/session";
import type { ServiceContext } from "@/server/context";
import { env } from "@/server/env";
import { resolveEngine } from "@/server/ai/service";
import { affiliateNetworks, content, productDecisions, productResearch, productTests, type Product, type ProductScore } from "@/server/db/schema";
import { getProductWithRelations } from "@/server/services/products";
import { latestScore, scoreHistory } from "@/server/services/scoring";
import { listCategories } from "@/server/services/catalog";
import { listLandingPages } from "@/server/services/landing-pages";
import { contentPerformance } from "@/server/services/content";
import { listLinks, trackedUrl } from "@/server/services/affiliate";
import { productStats, rangeForDays, timeseries } from "@/server/services/analytics";
import { experimentResults, listExperiments } from "@/server/services/experiments";
import { listRecommendations } from "@/server/services/recommendations";
import { getShopifyConnection } from "@/server/integrations/shopify";
import { isDemoMode } from "@/server/env";
import { Badge, ButtonLink, Callout, DemoTag, EmptyState, EngineBadge, Field, Input, KeyValue, Mono, PageHeader, Panel, ProvenanceBadge, Select, StatusBadge, Table, Tabs, Td, Th } from "@/components/admin/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/admin/forms";
import { Funnel, ScoreMeter, ScoreRing, StatTile } from "@/components/charts/marks";
import { TimeSeriesChart } from "@/components/charts/TimeSeriesChart";
import { ProductVisual } from "@/components/ProductVisual";
import { ProductForm } from "@/components/admin/ProductForm";
import { RecommendationList } from "@/components/admin/Recommendations";
import { deleteProductAction, enqueueJobAction, evaluateTestAction, scoreProductAction, setStatusAction, startTestAction, updateProductAction } from "../../../actions/products";
import { experimentStatusAction, quickExperimentAction } from "../../../actions/growth";
import { linkAction, shopifyOpAction } from "../../../actions/system";

const TABS = ["overview", "research", "content", "landing", "analytics", "links", "experiments", "recommendations"] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const ctx = await pageContext("products:read");
    const { product } = await getProductWithRelations(ctx, id);
    return { title: product.title };
  } catch {
    return { title: "Product" };
  }
}

function FactorBreakdown({ score }: { score: ProductScore | null }) {
  if (!score) return <EmptyState icon={Gauge} title="Not scored yet">Run the scoring engine to see the breakdown.</EmptyState>;
  return (
    <ul className="space-y-3">
      {SCORING_FACTORS.map((f) => {
        const fr = score.factors[f];
        if (!fr) return null;
        return (
          <li key={f} className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] items-center gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-fog">{FACTOR_META[f].label}</p>
              <p className="truncate text-[11px] text-dim" title={fr.note}>
                {fr.note}
              </p>
            </div>
            <ScoreMeter value={fr.score} />
            <div className="flex items-center gap-2">
              <span className="tabular w-8 text-end text-sm font-medium text-fog">{Math.round(fr.score)}</span>
              <span className="tabular w-10 text-end text-[11px] text-dim">×{fr.weight}</span>
              <ProvenanceBadge p={fr.provenance} compact />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

async function OverviewTab({ ctx, p, score, canWrite }: { ctx: ServiceContext; p: Product; score: ProductScore | null; canWrite: boolean }) {
  const [categories, history, decisions] = await Promise.all([listCategories(ctx), scoreHistory(ctx, p.id, 12), ctx.db.select().from(productDecisions).where(eq(productDecisions.productId, p.id)).orderBy(desc(productDecisions.createdAt)).limit(5)]);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        <Panel title="Score breakdown" subtitle={score ? `Engine ${score.engineVersion} · ${formatRelative(score.createdAt)} · weights configurable in Settings` : undefined}>
          <FactorBreakdown score={score} />
        </Panel>
        {canWrite && (
          <Panel title="Product facts" subtitle="Edit what you know — FORGE re-scores on save">
            <ProductForm action={updateProductAction} product={p} categories={categories} submitLabel="Save & re-score" />
          </Panel>
        )}
      </div>
      <div className="space-y-6">
        <Panel title="Why this score">
          {score?.reasons.length ? (
            <ul className="space-y-2 text-sm">
              {score.reasons.map((r) => (
                <li key={r} className="flex gap-2 text-haze">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-good" />
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-dim">No standout strengths yet.</p>
          )}
          {!!score?.warnings.length && (
            <>
              <p className="eyebrow mb-2 mt-5 text-dim">Warnings</p>
              <ul className="space-y-2 text-sm">
                {score.warnings.map((w) => (
                  <li key={w} className="flex gap-2 text-haze">
                    <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    {w}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <Panel title="Data provenance" subtitle="Where each metric came from">
          {Object.keys(p.fieldProvenance ?? {}).length ? (
            <ul className="space-y-1.5 text-xs">
              {Object.entries(p.fieldProvenance).map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-3">
                  <span className="truncate text-haze">{k}</span>
                  <span className="flex items-center gap-2">
                    <span className="max-w-32 truncate text-dim" title={v.source}>
                      {v.source}
                    </span>
                    <ProvenanceBadge p={v.p} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-dim">No tracked metrics yet.</p>
          )}
        </Panel>
        <Panel title="Score history">
          {history.length ? (
            <ul className="space-y-1 text-xs">
              {history.map((h, i) => (
                <li key={i} className="flex justify-between text-haze">
                  <span>{formatDate(h.createdAt, "en", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="tabular text-fog">
                    {round(h.overall)} <span className="text-dim">({round(h.confidence, 2)})</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-dim">—</p>
          )}
        </Panel>
        {decisions.length > 0 && (
          <Panel title="Decision history">
            <ul className="space-y-3 text-sm">
              {decisions.map((d) => (
                <li key={d.id}>
                  <div className="flex items-center justify-between">
                    <Badge tone={d.decision === "SCALE" ? "good" : d.decision === "KILL" ? "critical" : d.decision === "PAUSE" ? "warning" : "info"}>{d.decision.replace("_", " ").toLowerCase()}</Badge>
                    <span className="text-[11px] text-dim">{formatRelative(d.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-haze">{d.reasons.join(" ")}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {can(ctx.role, "products:delete") && (
          <Panel title="Danger zone">
            <ActionForm action={deleteProductAction}>
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton variant="danger" size="sm" confirm={`Delete “${p.title}” and all its content, pages and events? This cannot be undone.`}>
                Delete product
              </SubmitButton>
            </ActionForm>
          </Panel>
        )}
      </div>
    </div>
  );
}

async function ResearchTab({ ctx, p, canRun }: { ctx: ServiceContext; p: Product; canRun: boolean }) {
  const [rows, engine] = await Promise.all([ctx.db.select().from(productResearch).where(eq(productResearch.productId, p.id)).orderBy(desc(productResearch.createdAt)).limit(10), resolveEngine(ctx, "research")]);
  const r = rows[0];
  const run = canRun && (
    <ActionForm action={enqueueJobAction} className="inline-block">
      <input type="hidden" name="job" value="product_research" />
      <input type="hidden" name="productId" value={p.id} />
      <SubmitButton size="sm" variant="secondary" pendingText="Queuing…">
        <WandSparkles aria-hidden className="h-3.5 w-3.5" /> {r ? "Re-run research" : "Run research"}
      </SubmitButton>
    </ActionForm>
  );
  return (
    <div className="space-y-6">
      <Callout tone={engine.engine === "AI" ? "info" : "warning"} title={engine.engine === "AI" ? `Research runs on ${engine.provider} · ${engine.model} (strong tier)` : "Research runs on the template engine"}>
        {engine.engine === "AI" ? "AI output is stored as AI_INFERENCE and never overwrites real or operator data." : `${engine.reason}. The template engine restates the evidence FORGE holds — it never invents signals.`}
      </Callout>
      {!r ? (
        <EmptyState icon={FlaskConical} title="No research yet" action={run}>
          The Product Research Agent investigates demand, trend, competition, pricing, supply, shipping, social and content potential and risks.
        </EmptyState>
      ) : (
        <Panel
          title={
            <span className="flex flex-wrap items-center gap-2">
              Research report
              <Badge tone={r.verdict === "TEST" ? "good" : r.verdict === "WATCH" ? "info" : "critical"}>{r.verdict.replace(/_/g, " ").toLowerCase()}</Badge>
              <EngineBadge method={r.generationMethod} model={r.model} />
              <ProvenanceBadge p={r.provenance} />
            </span>
          }
          subtitle={formatDate(r.createdAt, "en", { dateStyle: "medium", timeStyle: "short" })}
          actions={run}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <blockquote className="rounded-md border-s-2 border-good bg-panel-2 p-4 text-sm leading-relaxed text-fog">{r.thesis}</blockquote>
            <blockquote className="rounded-md border-s-2 border-critical bg-panel-2 p-4 text-sm leading-relaxed text-fog">{r.antiThesis}</blockquote>
          </div>
          <KeyValue
            className="mt-6 lg:grid-cols-3"
            items={[
              { k: "Why it's trending", v: r.whyTrending },
              { k: "Demand", v: r.demand },
              { k: "Competition", v: r.competition },
              { k: "Supplier", v: r.supplierNotes },
              { k: "Shipping", v: r.shippingNotes },
              { k: "Social potential", v: r.socialPotential },
              { k: "Content opportunity", v: r.contentOpportunity },
              { k: "Target customer", v: r.targetCustomer },
              { k: "Landing-page angle", v: r.landingAngle },
              { k: "Pricing", v: r.pricing ? `cost ${r.pricing.supplierCost ?? "—"} · suggested ${r.pricing.suggestedPrice ?? "—"} · margin ${r.pricing.margin !== null && r.pricing.margin !== undefined ? `${Math.round(r.pricing.margin)}%` : "—"} · ${r.pricing.currency}` : "—" },
              { k: "Risk level", v: <Badge tone={r.riskLevel === "HIGH" ? "critical" : r.riskLevel === "MEDIUM" ? "warning" : "good"}>{r.riskLevel.toLowerCase()}</Badge> },
              { k: "Recommended action", v: r.recommendedAction },
            ]}
          />
          <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {(
              [
                ["Marketing angles", r.marketingAngles],
                ["Hooks", r.hooks],
                ["CTAs", r.ctas],
                ["Risks", r.risks],
              ] as const
            ).map(([label, items]) => (
              <div key={label}>
                <p className="eyebrow mb-2 text-dim">{label}</p>
                <ul className="space-y-1.5 text-sm text-haze">
                  {items.map((it) => (
                    <li key={it}>• {it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <p className="eyebrow mb-2 text-dim">Source evidence</p>
            {r.sourceEvidence.length ? (
              <ul className="space-y-1.5 text-xs">
                {r.sourceEvidence.map((e, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <ProvenanceBadge p={e.provenance} />
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-haze underline decoration-edge-2 underline-offset-2 hover:text-fog">
                        {e.label}
                      </a>
                    ) : (
                      <span className="text-haze">{e.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-dim">No external evidence recorded — connect a data source or add a trend keyword.</p>
            )}
          </div>
        </Panel>
      )}
      {rows.length > 1 && (
        <Panel title="Research history">
          <ul className="space-y-1 text-xs text-haze">
            {rows.slice(1).map((h) => (
              <li key={h.id} className="flex items-center justify-between">
                <span>{formatDate(h.createdAt, "en", { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="flex items-center gap-2">
                  {h.verdict} <EngineBadge method={h.generationMethod} model={h.model} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

async function ContentTab({ ctx, p, canRun }: { ctx: ServiceContext; p: Product; canRun: boolean }) {
  const items = await ctx.db.select().from(content).where(eq(content.productId, p.id)).orderBy(desc(content.createdAt)).limit(200);
  return (
    <div className="space-y-6">
      {canRun && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Launch batch" subtitle="10 TikTok concepts, scheduled one per day">
            <ActionForm action={enqueueJobAction}>
              <input type="hidden" name="job" value="content_generation" />
              <input type="hidden" name="productId" value={p.id} />
              <input type="hidden" name="batch" value="launch" />
              <input type="hidden" name="schedule" value="on" />
              <SubmitButton size="sm" pendingText="Queuing…">Generate 10 concepts</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Full social batch" subtitle="10 TikTok · 10 Reels · 10 Shorts · 10 Pins · 5 static · 5 carousels · 5 educational · 5 problem/solution">
            <ActionForm action={enqueueJobAction}>
              <input type="hidden" name="job" value="content_generation" />
              <input type="hidden" name="productId" value={p.id} />
              <input type="hidden" name="batch" value="full" />
              <SubmitButton size="sm" pendingText="Queuing…">Generate 60 items</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Custom">
            <ActionForm action={enqueueJobAction} className="grid grid-cols-2 gap-2">
              <input type="hidden" name="job" value="content_generation" />
              <input type="hidden" name="productId" value={p.id} />
              <Select name="platform" aria-label="Platform" options={PLATFORMS.filter((x) => ["TIKTOK", "INSTAGRAM", "YOUTUBE", "PINTEREST", "FACEBOOK", "X"].includes(x)).map((x) => ({ value: x, label: x.toLowerCase() }))} />
              <Select
                name="contentType"
                aria-label="Format"
                options={["TIKTOK_VIDEO", "INSTAGRAM_REEL", "YOUTUBE_SHORT", "PINTEREST_PIN", "STATIC_POST", "CAROUSEL", "EDUCATIONAL_POST", "PROBLEM_SOLUTION_POST", "AD_CONCEPT"].map((x) => ({ value: x, label: x.replace(/_/g, " ").toLowerCase() }))}
              />
              <Select name="angle" aria-label="Angle" options={[{ value: "", label: "mixed angles" }, ...CONTENT_ANGLES.map((a) => ({ value: a, label: a.replace(/_/g, " ").toLowerCase() }))]} />
              <Input name="count" type="number" min={1} max={30} defaultValue={5} aria-label="Count" />
              <SubmitButton size="sm" className="col-span-2" pendingText="Queuing…">
                Generate
              </SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      )}
      <Panel
        title={`Content (${items.length})`}
        subtitle="Every item carries a unique utm_content for attribution"
        bodyClassName="p-0"
        actions={
          items.length > 0 && (
            <div className="flex gap-1">
              {(["csv", "json", "markdown"] as const).map((f) => (
                <a key={f} href={`/api/v1/content/export?productId=${p.id}&format=${f}`} className="rounded px-2 py-1 text-xs text-haze hover:bg-panel-2 hover:text-fog">
                  {f.toUpperCase()}
                </a>
              ))}
            </div>
          )
        }
      >
        {items.length ? (
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Format</Th>
                <Th>Hook</Th>
                <Th>Angle</Th>
                <Th>Status</Th>
                <Th>utm_content</Th>
                <Th>Engine</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-panel-2/50">
                  <Td className="text-xs">
                    <span className="text-fog">{c.platform.toLowerCase()}</span>
                    <br />
                    <span className="text-dim">{c.contentType.replace(/_/g, " ").toLowerCase()}</span>
                  </Td>
                  <Td>
                    <Link href={`/admin/content/${c.id}`} className="line-clamp-2 max-w-md text-fog hover:underline">
                      {c.hook ?? c.title}
                    </Link>
                  </Td>
                  <Td className="text-xs">{c.angle?.replace(/_/g, " ").toLowerCase() ?? "—"}</Td>
                  <Td>
                    <Badge tone={c.status === "WINNER" ? "good" : c.status === "REJECTED" ? "critical" : c.status === "PUBLISHED" ? "info" : "neutral"}>{c.status.toLowerCase().replace("_", " ")}</Badge>
                  </Td>
                  <Td>
                    <Mono>{c.utmContent ?? "—"}</Mono>
                  </Td>
                  <Td>
                    <EngineBadge method={c.generationMethod} model={c.model} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No content yet">Generate a batch — concepts follow Hook 0–3s → Problem → Demo → Payoff → CTA.</EmptyState>
          </div>
        )}
      </Panel>
    </div>
  );
}

async function LandingTab({ ctx, p, canRun }: { ctx: ServiceContext; p: Product; canRun: boolean }) {
  const pages = await listLandingPages(ctx, { productId: p.id });
  return (
    <div className="space-y-6">
      {canRun && (
        <Panel title="Generate a landing page" subtitle="The Landing Page Agent writes the copy and assembles the sections for the template">
          <ActionForm action={enqueueJobAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="job" value="landing_page_generation" />
            <input type="hidden" name="productId" value={p.id} />
            <Field label="Template" htmlFor="tpl" className="w-72">
              <Select id="tpl" name="template" options={[{ value: "", label: "Auto (chosen from product traits)" }, ...LANDING_TEMPLATES.map((t) => ({ value: t, label: TEMPLATE_LAYOUTS[t].label }))]} />
            </Field>
            <SubmitButton pendingText="Queuing…">Generate page</SubmitButton>
          </ActionForm>
        </Panel>
      )}
      <Panel title="Pages" bodyClassName="p-0">
        {pages.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Page</Th>
                <Th>Template</Th>
                <Th>Status</Th>
                <Th>Engine</Th>
                <Th>Updated</Th>
                <Th align="end" />
              </tr>
            </thead>
            <tbody>
              {pages.map(({ page }) => (
                <tr key={page.id}>
                  <Td>
                    <p className="text-fog">{page.headline}</p>
                    <Mono>/lp/{page.slug}</Mono>
                  </Td>
                  <Td className="text-xs">{TEMPLATE_LAYOUTS[page.template].label}</Td>
                  <Td>
                    <Badge tone={page.status === "PUBLISHED" ? "good" : "neutral"}>{page.status.toLowerCase()}</Badge>
                  </Td>
                  <Td>
                    <EngineBadge method={page.generationMethod} model={page.model} />
                  </Td>
                  <Td className="text-xs">{formatRelative(page.updatedAt)}</Td>
                  <Td align="end">
                    <ButtonLink href={`/admin/landing-pages/${page.id}`} size="sm">
                      Open builder
                    </ButtonLink>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No landing page yet">Generate one above — it starts as a draft you can edit section by section.</EmptyState>
          </div>
        )}
      </Panel>
    </div>
  );
}

async function AnalyticsTab({ ctx, p }: { ctx: ServiceContext; p: Product }) {
  const range = rangeForDays(30);
  const [stats, ts, perf] = await Promise.all([productStats(ctx, p.id, range.from), timeseries(ctx, range, p.id), contentPerformance(ctx, { since: range.from, includeDemo: isDemoMode(), productId: p.id })]);
  const clicks = stats.affiliateClicks + stats.productClicks;
  const money = (v: number) => formatMoney(v, p.currency);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Page views" value={formatNumber(stats.pageViews)} spark={ts.map((d) => d.views)} />
        <StatTile label="Clicks" value={formatNumber(clicks)} spark={ts.map((d) => d.clicks)} />
        <StatTile label="Click-through" value={formatPercent(stats.pageViews ? clicks / stats.pageViews : 0)} />
        <StatTile label="Conversions" value={formatNumber(stats.conversions)} spark={ts.map((d) => d.conversions)} />
        <StatTile label={p.businessModel === "AFFILIATE" ? "Commission" : "Revenue"} value={money(p.businessModel === "AFFILIATE" ? stats.commission : stats.revenue)} />
        <StatTile label="Content views" value={formatNumber(stats.contentViews)} hint="From platform metrics (synced or entered manually)" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel title="Last 30 days" className="xl:col-span-2">
          <TimeSeriesChart
            title={p.title}
            points={ts.map((d) => ({ date: d.date, values: { views: d.views, clicks: d.clicks, conversions: d.conversions, revenue: d.revenue } }))}
            metrics={[
              { key: "views", label: "Page views", kind: "count" },
              { key: "clicks", label: "Clicks", kind: "count" },
              { key: "conversions", label: "Conversions", kind: "count" },
              { key: "revenue", label: "Earnings", kind: "currency", currency: p.currency },
            ]}
          />
        </Panel>
        <Panel title="Funnel" subtitle="Visit → click → purchase">
          <Funnel
            stages={[
              { label: "Page views", value: stats.pageViews },
              { label: p.businessModel === "AFFILIATE" ? "Affiliate clicks" : "Product clicks", value: clicks },
              { label: "Conversions", value: stats.conversions },
            ]}
          />
        </Panel>
      </div>
      <Panel title="Content performance" subtitle="Platform metrics joined with FORGE's own tracked visits (by utm_content)" bodyClassName="p-0">
        {perf.length ? (
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Content</Th>
                <Th align="end">Views</Th>
                <Th align="end">Engagement</Th>
                <Th align="end">Site visits</Th>
                <Th align="end">Clicks</Th>
                <Th align="end">Conv.</Th>
              </tr>
            </thead>
            <tbody>
              {perf
                .sort((a, b) => b.siteVisits - a.siteVisits)
                .slice(0, 20)
                .map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/admin/content/${c.id}`} className="text-fog hover:underline">
                        {c.hook ?? c.title}
                      </Link>
                      <p className="text-xs text-dim">
                        {c.platform.toLowerCase()} · <Mono>{c.utmContent}</Mono>
                      </p>
                    </Td>
                    <Td align="end">{formatNumber(c.views)}</Td>
                    <Td align="end">{formatPercent(c.engagementRate)}</Td>
                    <Td align="end">{formatNumber(c.siteVisits)}</Td>
                    <Td align="end">{formatNumber(c.affiliateClicks)}</Td>
                    <Td align="end">{formatNumber(c.conversions)}</Td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No content data yet" />
          </div>
        )}
      </Panel>
    </div>
  );
}

async function LinksTab({ ctx, p, canWrite }: { ctx: ServiceContext; p: Product; canWrite: boolean }) {
  const [links, networks] = await Promise.all([listLinks(ctx, { productId: p.id }), ctx.db.select().from(affiliateNetworks).where(eq(affiliateNetworks.organizationId, ctx.orgId))]);
  const primary = links.find((l) => l.link.isPrimary) ?? links[0];
  return (
    <div className="space-y-6">
      <Panel title="Tracked links" subtitle="Every outbound click goes through /r/{code}: logged with attribution, then redirected" bodyClassName="p-0">
        {links.length ? (
          <Table minWidth={960}>
            <thead>
              <tr>
                <Th>Tracked URL</Th>
                <Th>Destination</Th>
                <Th>Network</Th>
                <Th>Status</Th>
                <Th>Last check</Th>
                <Th align="end" />
              </tr>
            </thead>
            <tbody>
              {links.map(({ link, networkName }) => (
                <tr key={link.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Mono>/r/{link.code}</Mono>
                      <CopyButton value={trackedUrl(link.code)} />
                    </div>
                    {link.isPrimary && <span className="text-[11px] text-dim">primary</span>}
                  </Td>
                  <Td className="max-w-xs">
                    <span className="block truncate text-xs" title={link.url}>
                      {link.url}
                    </span>
                    {link.isDemo && <DemoTag />}
                  </Td>
                  <Td className="text-xs">{networkName ?? "direct / store"}</Td>
                  <Td>
                    <Badge tone={link.status === "ACTIVE" ? "good" : link.status === "BROKEN" ? "critical" : link.status === "PAUSED" ? "warning" : "neutral"}>{link.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-xs">
                    {link.lastCheckedAt ? formatRelative(link.lastCheckedAt) : "never"}
                    {link.lastError && <p className="max-w-48 truncate text-dim" title={link.lastError}>{link.lastError}</p>}
                  </Td>
                  <Td align="end">
                    {canWrite && (
                      <div className="flex justify-end gap-1">
                        <ActionForm action={linkAction}>
                          <input type="hidden" name="id" value={link.id} />
                          <input type="hidden" name="op" value="check" />
                          <SubmitButton size="sm" variant="ghost">Check</SubmitButton>
                        </ActionForm>
                        <ActionForm action={linkAction}>
                          <input type="hidden" name="id" value={link.id} />
                          <input type="hidden" name="op" value={link.status === "PAUSED" ? "activate" : "pause"} />
                          <SubmitButton size="sm" variant="ghost">{link.status === "PAUSED" ? "Activate" : "Pause"}</SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No tracked link yet">Add the affiliate deep link (or your store URL) below — FORGE generates the tracked /r/ URL.</EmptyState>
          </div>
        )}
      </Panel>
      {primary && (
        <Panel title="Tracked URLs per platform" subtitle="Paste these in bios, descriptions and pins — UTMs attribute every click">
          <ul className="space-y-2">
            {["TIKTOK", "INSTAGRAM", "YOUTUBE", "PINTEREST"].map((pl) => {
              const url = buildUtmUrl(new URL(`/products/${p.slug}`, env().APP_URL).toString(), { source: PLATFORM_UTM_SOURCE[pl], medium: "organic", campaign: p.slug, content: "bio" });
              return (
                <li key={pl} className="flex items-center gap-3 text-xs">
                  <span className="w-20 text-dim">{pl.toLowerCase()}</span>
                  <Mono className="min-w-0 flex-1 truncate">{url}</Mono>
                  <CopyButton value={url} />
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
      {canWrite && (
        <Panel title="Add a link">
          <ActionForm action={linkAction} className="grid gap-3 md:grid-cols-3" resetOnSuccess>
            <input type="hidden" name="op" value="create" />
            <input type="hidden" name="productId" value={p.id} />
            <Field label="Destination URL (affiliate deep link or store URL)" htmlFor="lurl" className="md:col-span-3">
              <Input id="lurl" name="url" type="url" required placeholder="https://…" defaultValue={p.affiliateUrl ?? ""} />
            </Field>
            <Field label="Network" htmlFor="lnet">
              <Select id="lnet" name="networkId" options={[{ value: "", label: "None (own store / direct)" }, ...networks.map((n) => ({ value: n.id, label: n.name }))]} />
            </Field>
            <Field label="Merchant" htmlFor="lmer">
              <Input id="lmer" name="merchant" maxLength={120} />
            </Field>
            <Field label="Commission %" htmlFor="lcom">
              <Input id="lcom" name="commissionRate" inputMode="decimal" defaultValue={p.commissionPercentage ?? ""} />
            </Field>
            <Field label="Cookie days" htmlFor="lck">
              <Input id="lck" name="cookieDays" inputMode="numeric" />
            </Field>
            <Field label="Country (ISO)" htmlFor="lcty">
              <Input id="lcty" name="country" maxLength={2} placeholder="US" />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-haze">
              <input type="checkbox" name="isPrimary" defaultChecked className="accent-s1" /> Primary link
            </label>
            <div className="md:col-span-3">
              <SubmitButton>Create tracked link</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
    </div>
  );
}

async function ExperimentsTab({ ctx, p, canWrite }: { ctx: ServiceContext; p: Product; canWrite: boolean }) {
  const [exps, pages] = await Promise.all([listExperiments(ctx, { productId: p.id }), listLandingPages(ctx, { productId: p.id })]);
  const results = await Promise.all(exps.map((e) => experimentResults(ctx, e)));
  return (
    <div className="space-y-6">
      {canWrite && pages.length > 0 && (
        <Panel title="Quick A/B test" subtitle="Two variants, 50/50, one running test per page">
          <ActionForm action={quickExperimentAction} className="grid gap-3 md:grid-cols-4">
            <Select name="pageId" aria-label="Page" options={pages.map(({ page }) => ({ value: page.id, label: `/lp/${page.slug}` }))} />
            <Select name="type" aria-label="Type" options={[{ value: "HEADLINE", label: "Headline" }, { value: "CTA", label: "CTA label" }, { value: "STRUCTURE", label: "Demo above the fold" }]} />
            <Input name="challenger" placeholder="Challenger text (headline / CTA)" maxLength={140} />
            <label className="flex items-center gap-2 text-sm text-haze">
              <input type="checkbox" name="start" defaultChecked className="accent-s1" /> Start now
            </label>
            <div className="md:col-span-4">
              <SubmitButton size="sm">Create experiment</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
      {exps.length ? (
        exps.map((e, i) => (
          <Panel
            key={e.id}
            title={
              <span className="flex items-center gap-2">
                {e.name} <Badge tone={e.status === "RUNNING" ? "info" : e.status === "COMPLETED" ? "good" : "neutral"}>{e.status.toLowerCase()}</Badge>
              </span>
            }
            subtitle={`${e.type.toLowerCase()} · primary metric ${e.primaryMetric.replace("_", " ").toLowerCase()}${e.hypothesis ? ` · ${e.hypothesis}` : ""}`}
            actions={
              canWrite && (
                <div className="flex gap-1">
                  {(e.status === "RUNNING" ? ["STOPPED", "COMPLETED"] : ["RUNNING"]).map((s) => (
                    <ActionForm key={s} action={experimentStatusAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="status" value={s} />
                      {s === "COMPLETED" && <input type="hidden" name="winner" value={[...results[i]].sort((a, b) => b.rate - a.rate)[0]?.key ?? ""} />}
                      <SubmitButton size="sm" variant="ghost">
                        {s === "RUNNING" ? "Start" : s === "STOPPED" ? "Stop" : "Complete (pick best)"}
                      </SubmitButton>
                    </ActionForm>
                  ))}
                </div>
              )
            }
            bodyClassName="p-0"
          >
            <Table minWidth={640}>
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th align="end">Impressions</Th>
                  <Th align="end">Conversions</Th>
                  <Th align="end">Rate</Th>
                  <Th align="end">Lift vs control</Th>
                  <Th align="end">p-value</Th>
                </tr>
              </thead>
              <tbody>
                {results[i].map((v) => (
                  <tr key={v.key}>
                    <Td>
                      <span className="text-fog">{v.name}</span> {e.winnerVariant === v.key && <Badge tone="good">winner</Badge>}
                    </Td>
                    <Td align="end">{formatNumber(v.impressions)}</Td>
                    <Td align="end">{formatNumber(v.conversions)}</Td>
                    <Td align="end">{formatPercent(v.rate, 2)}</Td>
                    <Td align="end">{v.vsControl?.lift === null || !v.vsControl ? "—" : `${v.vsControl.lift >= 0 ? "+" : ""}${formatPercent(v.vsControl.lift)}`}</Td>
                    <Td align="end">
                      {v.vsControl ? (
                        <span className="inline-flex items-center gap-2">
                          {round(v.vsControl.pValue, 3)} {v.vsControl.significant && <Badge tone="good">significant</Badge>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        ))
      ) : (
        <EmptyState title="No experiments yet">{pages.length ? "Create a quick A/B test above." : "Generate a landing page first."}</EmptyState>
      )}
    </div>
  );
}

async function RecommendationsTab({ ctx, p, canRun }: { ctx: ServiceContext; p: Product; canRun: boolean }) {
  const [recs, tests] = await Promise.all([listRecommendations(ctx, { productId: p.id, limit: 20 }), ctx.db.select().from(productTests).where(eq(productTests.productId, p.id)).orderBy(desc(productTests.startedAt)).limit(10)]);
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Panel title="AI recommendations">
        <RecommendationList items={recs} canAct={canRun} />
      </Panel>
      <Panel title="Tests" bodyClassName="p-0">
        {tests.length ? (
          <Table minWidth={520}>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Status</Th>
                <Th>Verdict</Th>
                <Th>Decision</Th>
                <Th align="end" />
              </tr>
            </thead>
            <tbody>
              {tests.map((t) => (
                <tr key={t.id}>
                  <Td className="text-xs">{formatDate(t.startedAt)}</Td>
                  <Td className="text-xs">{t.status.toLowerCase()}</Td>
                  <Td>{t.verdict ? <Badge tone={t.verdict === "WINNER" ? "good" : t.verdict === "FAILURE" ? "critical" : "info"}>{t.verdict.toLowerCase().replace("_", " ")}</Badge> : "—"}</Td>
                  <Td className="text-xs">{t.decision?.replace("_", " ").toLowerCase() ?? "—"}</Td>
                  <Td align="end">
                    {t.status === "RUNNING" && canRun && (
                      <ActionForm action={evaluateTestAction}>
                        <input type="hidden" name="testId" value={t.id} />
                        <SubmitButton size="sm" variant="ghost">Evaluate</SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="Never tested" />
          </div>
        )}
      </Panel>
    </div>
  );
}

export default async function ProductCommandCenter({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await pageContext("products:read");
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  let data: Awaited<ReturnType<typeof getProductWithRelations>>;
  try {
    data = await getProductWithRelations(ctx, id);
  } catch {
    notFound();
  }
  const { product: p, category, supplier } = data;
  const [score, runningTest, shopify] = await Promise.all([
    latestScore(ctx, p.id),
    ctx.db.select().from(productTests).where(and(eq(productTests.productId, p.id), eq(productTests.status, "RUNNING"))).limit(1),
    getShopifyConnection(ctx),
  ]);
  const canWrite = can(ctx.role, "products:write");
  const canRun = can(ctx.role, "agents:run");
  const f = score?.factors ?? {};
  const commission = p.affiliateCommission ?? (p.sellingPrice && p.commissionPercentage ? (p.sellingPrice * p.commissionPercentage) / 100 : null);
  const isPublic = PUBLIC_PRODUCT_STATUSES.includes(p.status);

  return (
    <>
      <div className="mb-4 text-xs text-dim">
        <Link href="/admin/products" className="hover:text-haze">
          Products
        </Link>{" "}
        / <span className="text-haze">{p.title}</span>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {p.title} <StatusBadge status={p.status} /> {p.isDemo && <DemoTag />}
          </span>
        }
        description={`${category?.name ?? "Uncategorised"} · ${p.businessModel.replace("_", " ").toLowerCase()} · source ${p.source.toLowerCase().replace(/_/g, " ")} · discovered ${formatDate(p.discoveredAt)}`}
        actions={
          <>
            {isPublic && (
              <ButtonLink href={`/products/${p.slug}`} external size="sm" variant="ghost">
                Storefront <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </ButtonLink>
            )}
            {canWrite && (
              <ActionForm action={scoreProductAction} className="inline-block">
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton size="sm" variant="secondary">
                  <Gauge aria-hidden className="h-3.5 w-3.5" /> Score now
                </SubmitButton>
              </ActionForm>
            )}
            {canWrite && !runningTest.length && !["KILLED", "ARCHIVED"].includes(p.status) && (
              <ActionForm action={startTestAction} className="inline-block">
                <input type="hidden" name="id" value={p.id} />
                <SubmitButton size="sm" variant="secondary" confirm="Publish the latest landing page and start a 14-day test?">
                  <FlaskConical aria-hidden className="h-3.5 w-3.5" /> Start test
                </SubmitButton>
              </ActionForm>
            )}
            {canRun && (
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="launch_test_kit" />
                <input type="hidden" name="productId" value={p.id} />
                <SubmitButton size="sm" variant="primary" pendingText="Queuing…">
                  <Rocket aria-hidden className="h-3.5 w-3.5" /> Launch kit
                </SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      <section className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex items-center gap-5">
          <ProductVisual title={p.title} slug={p.slug} imageUrl={p.imageUrl} categoryName={category?.name} categoryIcon={category?.icon} size="md" className="h-32 w-28 shrink-0 rounded-md" />
          <ScoreRing value={p.overallScore} caption={`conf. ${p.scoreConfidence === null ? "—" : round(p.scoreConfidence, 2)}`} />
        </div>
        <KeyValue
          className="self-center sm:grid-cols-3 lg:grid-cols-5"
          items={[
            { k: "Trend", v: <span className="flex items-center gap-2">{f.trend ? Math.round(f.trend.score) : "—"} <ProvenanceBadge p={f.trend?.provenance} compact /></span> },
            { k: "Demand", v: <span className="line-clamp-1" title={f.velocity?.note}>{f.velocity?.note ?? "—"}</span> },
            { k: "Competition", v: <span className="flex items-center gap-2">{p.competitionScore !== null ? Math.round(p.competitionScore) : "—"} <ProvenanceBadge p={p.fieldProvenance?.competitionScore?.p} compact /></span> },
            { k: "Margin", v: p.estimatedMargin !== null ? `${Math.round(p.estimatedMargin)}%` : "—" },
            { k: "Commission", v: commission !== null ? formatMoney(commission, p.currency) : "—" },
            { k: "Price", v: p.sellingPrice !== null ? formatMoney(p.sellingPrice, p.currency) : "—" },
            { k: "Supplier", v: supplier?.name ?? (p.businessModel === "AFFILIATE" ? "merchant (affiliate)" : "—") },
            { k: "Shipping", v: p.shippingDaysMax !== null ? `${p.shippingDaysMin ?? "?"}–${p.shippingDaysMax} days` : "—" },
            { k: "Risk", v: p.riskLevel ? <Badge tone={p.riskLevel === "HIGH" ? "critical" : p.riskLevel === "MEDIUM" ? "warning" : "good"}>{p.riskLevel.toLowerCase()}</Badge> : "—" },
            { k: "Model", v: p.businessModel.replace("_", " ").toLowerCase() },
          ]}
        />
        {canWrite && (
          <ActionForm action={setStatusAction} className="flex items-end gap-2 self-center">
            <input type="hidden" name="id" value={p.id} />
            <Field label="Status" htmlFor="status">
              <Select id="status" name="status" defaultValue={p.status} className="w-40" options={PRODUCT_STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))} />
            </Field>
            <SubmitButton size="md" variant="secondary">
              Set
            </SubmitButton>
          </ActionForm>
        )}
      </section>
      {p.riskFlags.length > 0 && (
        <Callout tone={p.riskLevel === "HIGH" ? "critical" : "warning"} className="mb-6" title="Compliance & risk flags">
          <ul className="list-disc ps-5 text-xs">
            {p.riskFlags.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Callout>
      )}
      {shopify && canWrite && p.businessModel !== "AFFILIATE" && (
        <div className="mb-6">
          <ActionForm action={shopifyOpAction} className="inline-block">
            <input type="hidden" name="op" value="publish" />
            <input type="hidden" name="productId" value={p.id} />
            <SubmitButton size="sm" variant="secondary">{p.shopifyProductId ? "Update in Shopify" : "Publish to Shopify (draft)"}</SubmitButton>
          </ActionForm>
        </div>
      )}

      <Tabs items={TABS.map((t) => ({ href: `/admin/products/${p.id}?tab=${t}`, label: t[0].toUpperCase() + t.slice(1), active: t === tab }))} />
      <div className="mt-6">
        {tab === "overview" && <OverviewTab ctx={ctx} p={p} score={score} canWrite={canWrite} />}
        {tab === "research" && <ResearchTab ctx={ctx} p={p} canRun={canRun} />}
        {tab === "content" && <ContentTab ctx={ctx} p={p} canRun={canRun} />}
        {tab === "landing" && <LandingTab ctx={ctx} p={p} canRun={canRun} />}
        {tab === "analytics" && <AnalyticsTab ctx={ctx} p={p} />}
        {tab === "links" && <LinksTab ctx={ctx} p={p} canWrite={canWrite} />}
        {tab === "experiments" && <ExperimentsTab ctx={ctx} p={p} canWrite={can(ctx.role, "experiments:write")} />}
        {tab === "recommendations" && <RecommendationsTab ctx={ctx} p={p} canRun={canRun} />}
      </div>
    </>
  );
}
