import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { CONTENT_STATUSES, PLATFORMS, type ContentStatus, type Platform } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { isDemoMode } from "@/server/env";
import { pageContext } from "@/server/auth/session";
import { contentPerformance, listContent, summarizeWinners } from "@/server/services/content";
import { Badge, ButtonLink, DemoTag, EmptyState, EngineBadge, KeyValue, Mono, PageHeader, Panel, Select, Table, Td, Th, btn } from "@/components/admin/ui";
import { formatPercent } from "@/lib/utils";

export const metadata = { title: "Content" };

export const statusTone = (s: string) => (s === "WINNER" ? "good" : s === "REJECTED" ? "critical" : s === "PUBLISHED" || s === "ANALYZING" ? "info" : s === "SCHEDULED" ? "warning" : "neutral") as "good" | "critical" | "info" | "warning" | "neutral";

export default async function ContentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await pageContext("content:read");
  const sp = await searchParams;
  const status = (CONTENT_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as ContentStatus) : undefined;
  const platform = (PLATFORMS as readonly string[]).includes(sp.platform ?? "") ? (sp.platform as Platform) : undefined;
  const [{ items, total }, perf] = await Promise.all([listContent(ctx, { status, platform, limit: 200 }), contentPerformance(ctx, { since: new Date(Date.now() - 30 * 86400_000), includeDemo: isDemoMode() })]);
  const winners = summarizeWinners(perf);
  const ids = items.map((i) => i.id).join(",");

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Content"
        description="Short-form scripts, captions, pins and posts — each with a tracked link and a unique utm_content, so the performance loop can learn which hooks, formats and platforms win."
        actions={
          <>
            <ButtonLink href="/admin/content/calendar">Calendar</ButtonLink>
            {items.length > 0 && (
              <a className={btn("secondary")} href={`/api/v1/content/export?ids=${ids.slice(0, 7000)}&format=csv`}>
                Export CSV
              </a>
            )}
          </>
        }
      />
      <Panel className="mb-6" title="What's winning (last 30 days)" subtitle={`${winners.sample} items with enough data · platform metrics + FORGE-tracked visits`}>
        {winners.sample ? (
          <KeyValue
            className="lg:grid-cols-5"
            items={[
              { k: "Winning hook", v: winners.hook ? <span>“{winners.hook.key}” <span className="text-dim">({formatPercent(winners.hook.ctr)} CTR)</span></span> : "—" },
              { k: "Winning format", v: winners.format ? `${winners.format.key.replace(/_/g, " ").toLowerCase()} (${formatPercent(winners.format.ctr)})` : "—" },
              { k: "Winning platform", v: winners.platform ? `${winners.platform.key.toLowerCase()} (${formatPercent(winners.platform.ctr)})` : "—" },
              { k: "Winning angle", v: winners.angle ? `${winners.angle.key.replace(/_/g, " ").toLowerCase()}` : "—" },
              { k: "Winning product", v: winners.product?.key ?? "—" },
            ]}
          />
        ) : (
          <p className="text-sm text-dim">Publish content and record platform metrics (or connect APIs) to see winners.</p>
        )}
      </Panel>
      <form method="get" className="mb-4 flex flex-wrap items-center gap-3">
        <Select name="status" defaultValue={status ?? ""} aria-label="Status" className="w-44" options={[{ value: "", label: "All statuses" }, ...CONTENT_STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() }))]} />
        <Select name="platform" defaultValue={platform ?? ""} aria-label="Platform" className="w-44" options={[{ value: "", label: "All platforms" }, ...PLATFORMS.map((p) => ({ value: p, label: p.toLowerCase() }))]} />
        <button className={btn("secondary")} type="submit">
          Filter
        </button>
        <span className="text-xs text-dim">{total} items</span>
      </form>
      <Panel bodyClassName="p-0">
        {items.length ? (
          <Table minWidth={1100}>
            <thead>
              <tr>
                <Th>Content</Th>
                <Th>Product</Th>
                <Th>Format</Th>
                <Th>Status</Th>
                <Th>Scheduled</Th>
                <Th>utm_content</Th>
                <Th>Engine</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="hover:bg-panel-2/50">
                  <Td>
                    <Link href={`/admin/content/${c.id}`} className="line-clamp-2 max-w-md font-medium text-fog hover:underline">
                      {c.hook ?? c.title}
                    </Link>
                    <p className="text-[11px] text-dim">{c.angle?.replace(/_/g, " ").toLowerCase()}</p>
                  </Td>
                  <Td className="text-xs">
                    {c.productTitle ?? "—"} {c.isDemo && <DemoTag />}
                  </Td>
                  <Td className="text-xs">
                    {c.platform.toLowerCase()} · {c.contentType.replace(/_/g, " ").toLowerCase()}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ").toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-xs">{c.scheduledAt ? formatDate(c.scheduledAt, "en", { dateStyle: "medium" }) : "—"}</Td>
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
            <EmptyState icon={Clapperboard} title="No content yet">
              Generate concepts from a product’s Content tab or run a launch kit.
            </EmptyState>
          </div>
        )}
      </Panel>
    </>
  );
}
