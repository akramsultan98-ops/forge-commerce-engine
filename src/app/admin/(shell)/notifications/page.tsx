import Link from "next/link";
import { Bell } from "lucide-react";
import { formatRelative } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { listNotifications } from "@/server/services/notifications";
import { integrationOverview } from "@/server/integrations/status";
import { listRecommendations } from "@/server/services/recommendations";
import { Badge, Callout, EmptyState, PageHeader, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { markReadAction } from "../../actions/growth";

export const metadata = { title: "Notifications" };

const ENTITY_HREF: Record<string, (id: string) => string> = {
  product: (id) => `/admin/products/${id}`,
  report: (id) => `/admin/reports?id=${id}`,
  affiliate_link: () => `/admin/affiliate-networks`,
};

export default async function NotificationsPage() {
  const ctx = await pageContext();
  const [items, overview, done] = await Promise.all([listNotifications(ctx, { limit: 100 }), integrationOverview(ctx), listRecommendations(ctx, { status: "DONE", limit: 10 })]);
  const unread = items.filter((n) => !n.readAt).length;
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Notifications"
        description="New opportunities, winners, kill recommendations, broken links, spikes and unavailable inventory. Delivered to the dashboard, and to email/Telegram when configured."
        actions={
          unread > 0 && (
            <ActionForm action={markReadAction} className="inline-block">
              <SubmitButton variant="secondary">Mark all read ({unread})</SubmitButton>
            </ActionForm>
          )
        }
      />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Callout tone={overview.demoMode ? "warning" : "info"} title="Dashboard">
          Always on.
        </Callout>
        <Callout tone={overview.email.configured ? "info" : "warning"} title={`Email — ${overview.email.configured ? "configured" : "not configured"}`}>
          {overview.email.configured ? (overview.demoMode ? "Suppressed while DEMO_MODE is on." : "Enable in Settings → Notifications.") : overview.email.requirements.join(", ")}
        </Callout>
        <Callout tone={overview.telegram.configured ? "info" : "warning"} title={`Telegram — ${overview.telegram.configured ? "configured" : "not configured"}`}>
          {overview.telegram.configured ? (overview.demoMode ? "Suppressed while DEMO_MODE is on." : "Enable in Settings → Notifications.") : overview.telegram.requirements.join(", ")}
        </Callout>
      </div>
      <Panel bodyClassName="p-0">
        {items.length ? (
          <ul className="divide-y divide-edge">
            {items.map((n) => {
              const href = n.entityType && n.entityId ? ENTITY_HREF[n.entityType]?.(n.entityId) : undefined;
              return (
                <li key={n.id} className={n.readAt ? "px-5 py-4 opacity-70" : "px-5 py-4"}>
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <span aria-label="unread" className="h-2 w-2 rounded-full bg-s1" />}
                    <Badge tone={n.severity === "success" ? "good" : n.severity === "warning" ? "warning" : n.severity === "critical" ? "critical" : "info"}>{n.type.replace(/_/g, " ").toLowerCase()}</Badge>
                    <span className="text-[11px] text-dim">{formatRelative(n.createdAt)}</span>
                    <span className="ms-auto font-mono text-[10px] text-dim">
                      {Object.entries(n.delivery)
                        .map(([k, v]) => `${k.toLowerCase()}:${v}`)
                        .join(" · ")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-fog">{href ? <Link href={href} className="hover:underline">{n.title}</Link> : n.title}</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-haze">{n.body}</p>
                  {!n.readAt && (
                    <ActionForm action={markReadAction} className="mt-2">
                      <input type="hidden" name="id" value={n.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Mark read
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState icon={Bell} title="All quiet" />
          </div>
        )}
      </Panel>
      {done.length > 0 && (
        <Panel className="mt-6" title="Recently completed recommendations">
          <ul className="space-y-2 text-sm text-haze">
            {done.map(({ rec, productTitle }) => (
              <li key={rec.id}>
                ✓ {rec.title} {productTitle && <span className="text-dim">— {productTitle}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
