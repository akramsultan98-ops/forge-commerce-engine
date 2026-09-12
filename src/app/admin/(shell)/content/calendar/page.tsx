import Link from "next/link";
import { and, eq, isNull, or } from "drizzle-orm";
import { cn, isoDate } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { content } from "@/server/db/schema";
import { listContent } from "@/server/services/content";
import { Badge, PageHeader, Panel, btn } from "@/components/admin/ui";
import { statusTone } from "../page";

export const metadata = { title: "Content calendar" };

const DOT: Record<string, string> = { TIKTOK: "bg-s1", INSTAGRAM: "bg-s2", YOUTUBE: "bg-s3", PINTEREST: "bg-b250", FACEBOOK: "bg-b550", X: "bg-dim" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await pageContext("content:read");
  const { month } = await searchParams;
  const now = new Date();
  const [y, m] = /^\d{4}-\d{2}$/.test(month ?? "") ? month!.split("-").map(Number) : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const [{ items }, unscheduled] = await Promise.all([
    listContent(ctx, { from: start, to: end, limit: 500 }),
    ctx.db
      .select({ id: content.id, hook: content.hook, title: content.title, platform: content.platform, status: content.status })
      .from(content)
      .where(and(eq(content.organizationId, ctx.orgId), isNull(content.scheduledAt), or(eq(content.status, "SCRIPTED"), eq(content.status, "ASSET_READY"), eq(content.status, "IDEA"))))
      .limit(30),
  ]);
  const byDay = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.scheduledAt) continue;
    const k = isoDate(it.scheduledAt);
    byDay.set(k, [...(byDay.get(k) ?? []), it]);
  }
  const leading = (start.getUTCDay() + 6) % 7; // Monday-first grid
  const days = Math.round((end.getTime() - start.getTime()) / 86400_000);
  const cells = [...Array(leading).fill(null), ...Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, m - 1, i + 1)))];
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const next = new Date(Date.UTC(y, m, 1));
  const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const today = isoDate(now);

  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Content calendar"
        description="Scheduled content by publishing date (UTC). Statuses: idea → scripted → asset ready → scheduled → published → analyzing → winner / rejected."
        actions={
          <div className="flex items-center gap-2">
            <Link className={btn("secondary", "sm")} href={`/admin/content/calendar?month=${ym(prev)}`}>
              ←
            </Link>
            <span className="min-w-36 text-center text-sm text-fog">{start.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
            <Link className={btn("secondary", "sm")} href={`/admin/content/calendar?month=${ym(next)}`}>
              →
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-x-auto scrollbar-thin">
          <div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded-lg border border-edge bg-edge">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="bg-panel-2 px-3 py-2 text-[11px] uppercase tracking-wider text-dim">
                {d}
              </div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className="min-h-28 bg-night" />;
              const k = isoDate(d);
              const list = byDay.get(k) ?? [];
              return (
                <div key={k} className={cn("min-h-28 bg-panel p-2", k === today && "ring-1 ring-inset ring-s1")}>
                  <p className={cn("mb-1 text-xs", k === today ? "font-semibold text-fog" : "text-dim")}>{d.getUTCDate()}</p>
                  <ul className="space-y-1">
                    {list.slice(0, 4).map((c) => (
                      <li key={c.id}>
                        <Link href={`/admin/content/${c.id}`} className="flex items-center gap-1.5 rounded bg-panel-2 px-1.5 py-1 text-[11px] text-haze hover:text-fog" title={`${c.platform} · ${c.status} · ${c.productTitle ?? ""}`}>
                          <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT[c.platform] ?? "bg-dim")} />
                          <span className="truncate">{c.hook ?? c.title}</span>
                        </Link>
                      </li>
                    ))}
                    {list.length > 4 && <li className="px-1.5 text-[10px] text-dim">+{list.length - 4} more</li>}
                  </ul>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-dim">
            {Object.entries(DOT).map(([p, c]) => (
              <span key={p} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", c)} /> {p.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
        <Panel title="Unscheduled" subtitle="Open an item to set its date">
          {unscheduled.length ? (
            <ul className="space-y-2">
              {unscheduled.map((c) => (
                <li key={c.id}>
                  <Link href={`/admin/content/${c.id}`} className="block rounded border border-edge px-2.5 py-2 text-xs text-haze hover:border-edge-2 hover:text-fog">
                    <span className="mb-1 flex items-center gap-2">
                      <Badge tone={statusTone(c.status)}>{c.status.replace("_", " ").toLowerCase()}</Badge>
                      <span className="text-dim">{c.platform.toLowerCase()}</span>
                    </span>
                    <span className="line-clamp-2">{c.hook ?? c.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-dim">Everything is scheduled.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
