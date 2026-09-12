import Link from "next/link";
import { ListChecks } from "lucide-react";
import { can } from "@/lib/rbac";
import { cn, formatDate } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { getReport, latestReport, listReports, type Top5Entry } from "@/server/services/reports";
import { DemoTag, EmptyState, PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { ReportView } from "@/components/admin/ReportView";
import { enqueueJobAction } from "../../actions/products";

export const metadata = { title: "Top 5 reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await pageContext("reports:read");
  const { id } = await searchParams;
  const [list, current] = await Promise.all([listReports(ctx, 30), id ? getReport(ctx, id) : latestReport(ctx)]);
  const content = current?.content as { title?: string; entries?: Top5Entry[]; note?: string } | undefined;
  return (
    <>
      <PageHeader
        eyebrow="Intelligence"
        title="Top 5 products to test"
        description="Generated daily and weekly by the Reporting Agent. Never claims sales figures it doesn't have — every field shows its evidence."
        actions={
          can(ctx.role, "agents:run") && (
            <>
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="report_generation" />
                <input type="hidden" name="type" value="TOP5_DAILY" />
                <SubmitButton variant="secondary" pendingText="Queuing…">Generate daily</SubmitButton>
              </ActionForm>
              <ActionForm action={enqueueJobAction} className="inline-block">
                <input type="hidden" name="job" value="report_generation" />
                <input type="hidden" name="type" value="TOP5_WEEKLY" />
                <SubmitButton pendingText="Queuing…">Generate weekly</SubmitButton>
              </ActionForm>
            </>
          )
        }
      />
      {current && content ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-lg font-semibold text-fog">{content.title}</h2>
              {current.isDemo && <DemoTag />}
              <span className="text-xs text-dim">{formatDate(current.createdAt, "en", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            <ReportView entries={content.entries ?? []} note={content.note} />
          </div>
          <Panel title="History" bodyClassName="p-2">
            <ul>
              {list.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/reports?id=${r.id}`} className={cn("flex items-center justify-between rounded px-3 py-2 text-xs hover:bg-panel-2", r.id === current.id ? "bg-panel-2 text-fog" : "text-haze")}>
                    <span>{r.type === "TOP5_WEEKLY" ? "Weekly" : "Daily"}</span>
                    <span className="text-dim">{formatDate(r.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      ) : (
        <EmptyState icon={ListChecks} title="No reports yet">
          Generate one now, or wait for the scheduled daily/weekly run.
        </EmptyState>
      )}
    </>
  );
}
