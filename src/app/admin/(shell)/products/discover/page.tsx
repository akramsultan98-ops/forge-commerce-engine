import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Compass, Rocket, Upload } from "lucide-react";
import { MARKETS } from "@/lib/constants";
import { can } from "@/lib/rbac";
import { formatRelative, round } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { agentRuns } from "@/server/db/schema";
import { getSetting } from "@/server/settings";
import { integrationOverview } from "@/server/integrations/status";
import { listProducts } from "@/server/services/products";
import { Badge, ButtonLink, Callout, DemoTag, EmptyState, Field, Input, Mono, PageHeader, Panel, Select, StatusBadge, Table, Td, Textarea, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { ScoreMeter } from "@/components/charts/marks";
import { enqueueJobAction, importCsvAction, researchPortfolioAction } from "../../../actions/products";

export const metadata = { title: "Discover" };

const SAMPLE = `title,price,cost,commission,url,affiliate_url,category,rating,reviews,shipping_days,countries,trend_keyword,business_model
"Silicone Stretch Lids (6-Pack)",14.99,2.80,,https://shop.example/lids,,Home & Kitchen,4.4,1800,12,US|GB,,DROPSHIPPING
"Mini Thermal Label Printer",39.99,,10,https://merchant.example/printer,https://network.example/deep?id=1,Desk & Tech,,,,US|CA,Label printer,AFFILIATE`;

type Ranked = { ranked?: Array<{ rank: number; productId: string; title: string; score: number | null; fitScore: number; verdict: string; thesis: string | null; isDemo: boolean }>; market?: string };

export default async function DiscoverPage() {
  const ctx = await pageContext("products:read");
  const [overview, recent, onboarding, lastRanking] = await Promise.all([
    integrationOverview(ctx),
    listProducts(ctx, { status: ["DISCOVERED", "RESEARCHING"], sort: "recent", limit: 15 }),
    getSetting(ctx, "onboarding"),
    ctx.db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.organizationId, ctx.orgId), eq(agentRuns.agent, "research"), eq(agentRuns.status, "succeeded")))
      .orderBy(desc(agentRuns.createdAt))
      .limit(20),
  ]);
  const ranking = lastRanking.find((r) => (r.output as Ranked)?.ranked);
  const canRun = can(ctx.role, "agents:run");
  const canWrite = can(ctx.role, "products:write");

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Product discovery"
        description="Official APIs, product feeds and CSV imports feed the catalog; every record keeps its provenance. FORGE never scrapes platforms in violation of their terms."
        actions={
          canRun && (
            <>
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="first_run" />
                <SubmitButton variant="secondary" pendingText="Queuing…">
                  <Rocket aria-hidden className="h-4 w-4" /> {onboarding.firstRunAt ? "Re-run first-run workflow" : "Run first-run workflow"}
                </SubmitButton>
              </ActionForm>
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="product_discovery" />
                <SubmitButton pendingText="Queuing…">
                  <Compass aria-hidden className="h-4 w-4" /> Run discovery
                </SubmitButton>
              </ActionForm>
            </>
          )
        }
      />
      {!onboarding.firstRunAt && (
        <Callout className="mb-6" title="First run: discovery → trend signals → scoring → Top 5 → launch kits">
          The first-run workflow discovers candidates from every configured source, pulls real interest signals, scores everything, writes the Top 5 report and generates a launch kit (research, landing page, 10 short-form concepts, tracked links) for each of the top five.{" "}
          {overview.demoMode && "In DEMO_MODE the results are labelled DEMO DATA — they are not live market research."}
        </Callout>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Sources" subtitle="Adapter architecture — add a source by implementing one interface" actions={<ButtonLink href="/admin/sources" size="sm" variant="ghost">Configure</ButtonLink>} bodyClassName="p-0">
          <Table minWidth={680}>
            <thead>
              <tr>
                <Th>Adapter</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Last run</Th>
              </tr>
            </thead>
            <tbody>
              {overview.sources.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <p className="text-fog">{s.adapter?.label ?? s.name}</p>
                    <p className="text-[11px] text-dim">
                      {s.adapter?.officialApi ? "official API / feed" : "no public API"} · {s.adapter?.implementation === "interface" ? "interface (needs approved access)" : "implemented"}
                    </p>
                  </Td>
                  <Td className="text-xs">{s.adapter?.kind}</Td>
                  <Td>
                    <Badge tone={s.status === "CONNECTED" ? "good" : s.status === "ERROR" ? "critical" : s.status === "DEMO" ? "warning" : "neutral"}>{s.status.replace("_", " ").toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-xs">
                    {s.lastRunAt ? `${formatRelative(s.lastRunAt)} · ${s.lastResultCount ?? 0} found` : "never"}
                    {s.lastError && <p className="max-w-56 truncate text-[#ff9b9b]" title={s.lastError}>{s.lastError}</p>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <div className="space-y-6">
          {canWrite && (
            <Panel title="Import a CSV feed" subtitle="Supplier exports, affiliate catalogs, spreadsheets" id="import">
              <ActionForm action={importCsvAction} className="space-y-3" resetOnSuccess>
                <Field label="CSV file (≤ 5 MB)" htmlFor="file">
                  <input id="file" name="file" type="file" accept=".csv,text/csv,text/plain" className="block w-full text-xs text-haze file:me-3 file:rounded-md file:border file:border-edge-2 file:bg-panel-2 file:px-3 file:py-1.5 file:text-fog" />
                </Field>
                <Field label="…or paste CSV" htmlFor="csv">
                  <Textarea id="csv" name="csv" rows={4} placeholder={SAMPLE.split("\n")[0]} className="font-mono text-[11px]" />
                </Field>
                <Field label="Default business model" htmlFor="businessModel">
                  <Select id="businessModel" name="businessModel" options={[{ value: "AFFILIATE", label: "Affiliate" }, { value: "DROPSHIPPING", label: "Dropshipping" }, { value: "SHOPIFY", label: "Shopify" }, { value: "LANDING_PAGE", label: "Landing page" }]} />
                </Field>
                <SubmitButton pendingText="Importing…">
                  <Upload aria-hidden className="h-4 w-4" /> Import & score
                </SubmitButton>
              </ActionForm>
              <details className="mt-4 text-xs text-dim">
                <summary className="hover:text-haze">Column reference & example</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-night p-3 font-mono text-[10px] leading-relaxed text-haze scrollbar-thin">{SAMPLE}</pre>
                <p className="mt-2">Imported values are stored as MANUAL provenance. Lists use “|”. Unknown columns are ignored and reported.</p>
              </details>
            </Panel>
          )}
          {canRun && (
            <Panel title="Product Research Agent" subtitle="Rank the catalog against your constraints">
              <ActionForm action={researchPortfolioAction} className="grid grid-cols-2 gap-3">
                <Field label="Market" htmlFor="market">
                  <Select id="market" name="market" options={MARKETS.map((m) => ({ value: m.code, label: m.name }))} />
                </Field>
                <Field label="Business model" htmlFor="bm">
                  <Select id="bm" name="businessModel" options={[{ value: "", label: "Any" }, { value: "AFFILIATE", label: "Affiliate" }, { value: "DROPSHIPPING", label: "Dropshipping" }]} />
                </Field>
                <Field label="Budget (USD)" htmlFor="budget">
                  <Input id="budget" name="budget" inputMode="numeric" placeholder="500" />
                </Field>
                <Field label="Desired margin %" htmlFor="margin">
                  <Input id="margin" name="desiredMarginPct" inputMode="numeric" placeholder="40" />
                </Field>
                <Field label="Max price (USD)" htmlFor="maxp">
                  <Input id="maxp" name="maxPriceUsd" inputMode="numeric" placeholder="50" />
                </Field>
                <Field label="Target audience" htmlFor="aud">
                  <Input id="aud" name="targetAudience" placeholder="pet owners" />
                </Field>
                <div className="col-span-2">
                  <SubmitButton pendingText="Queuing…">Rank products</SubmitButton>
                </div>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>

      {ranking && (
        <Panel className="mt-6" title="Latest research ranking" subtitle={`${formatRelative(ranking.createdAt)} · market ${(ranking.output as Ranked).market ?? "US"}`} bodyClassName="p-0">
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Product</Th>
                <Th align="end">Fit</Th>
                <Th>Verdict</Th>
                <Th>Thesis</Th>
              </tr>
            </thead>
            <tbody>
              {((ranking.output as Ranked).ranked ?? []).map((r) => (
                <tr key={r.productId}>
                  <Td className="tabular">{r.rank}</Td>
                  <Td>
                    <Link href={`/admin/products/${r.productId}?tab=research`} className="text-fog hover:underline">
                      {r.title}
                    </Link>{" "}
                    {r.isDemo && <DemoTag />}
                  </Td>
                  <Td align="end">{round(r.fitScore)}</Td>
                  <Td>
                    <Badge tone={r.verdict === "TEST" ? "good" : r.verdict === "WATCH" ? "info" : r.verdict === "DO_NOT_TEST" ? "critical" : "neutral"}>{r.verdict.replace(/_/g, " ").toLowerCase()}</Badge>
                  </Td>
                  <Td className="max-w-lg text-xs">{r.thesis ?? "Not researched (outside the top 3 — cost control)"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      )}

      <Panel className="mt-6" title="Recently discovered" bodyClassName="p-0" actions={<ButtonLink href="/admin/products?status=DISCOVERED" size="sm" variant="ghost">All</ButtonLink>}>
        {recent.items.length ? (
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Source</Th>
                <Th>Score</Th>
                <Th>Status</Th>
                <Th>Discovered</Th>
              </tr>
            </thead>
            <tbody>
              {recent.items.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/admin/products/${p.id}`} className="text-fog hover:underline">
                      {p.title}
                    </Link>{" "}
                    {p.isDemo && <DemoTag />}
                  </Td>
                  <Td>
                    <Mono>{p.source.toLowerCase()}</Mono>
                  </Td>
                  <Td className="w-40">
                    <div className="flex items-center gap-2">
                      <span className="tabular w-8 text-fog">{p.overallScore === null ? "—" : Math.round(p.overallScore)}</span>
                      <ScoreMeter value={p.overallScore} className="w-20" />
                    </div>
                  </Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                  <Td className="text-xs">{formatRelative(p.discoveredAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="Nothing discovered yet">Run discovery or import a CSV.</EmptyState>
          </div>
        )}
      </Panel>
    </>
  );
}
