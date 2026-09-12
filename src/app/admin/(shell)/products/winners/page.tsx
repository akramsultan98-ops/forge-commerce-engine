import Link from "next/link";
import { Trophy } from "lucide-react";
import { can } from "@/lib/rbac";
import { formatNumber, formatPercent } from "@/lib/utils";
import { formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { listProducts } from "@/server/services/products";
import { productStats } from "@/server/services/analytics";
import { latestDecision } from "@/server/services/testing";
import { Badge, DemoTag, EmptyState, PageHeader, Panel, StatusBadge } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { ProductVisual } from "@/components/ProductVisual";
import { enqueueJobAction, setStatusAction } from "../../../actions/products";

export const metadata = { title: "Winners" };

export default async function WinnersPage() {
  const ctx = await pageContext("products:read");
  const { items } = await listProducts(ctx, { status: ["WINNER", "SCALING"], sort: "score", limit: 50 });
  const since = new Date(Date.now() - 30 * 86400_000);
  const [stats, decisions] = await Promise.all([Promise.all(items.map((p) => productStats(ctx, p.id, since))), Promise.all(items.map((p) => latestDecision(ctx, p.id)))]);
  const canRun = can(ctx.role, "agents:run");

  return (
    <>
      <PageHeader eyebrow="Catalog" title="Winners" description="Products that cleared the winner thresholds. Scale what works: more content on the winning angle, more traffic, then Shopify or paid distribution." />
      {items.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((p, i) => {
            const s = stats[i];
            const clicks = s.affiliateClicks + s.productClicks;
            return (
              <Panel key={p.id}>
                <div className="flex gap-4">
                  <ProductVisual title={p.title} slug={p.slug} imageUrl={p.imageUrl} size="sm" className="h-20 w-20 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/products/${p.id}`} className="truncate font-medium text-fog hover:underline">
                        {p.title}
                      </Link>
                      <StatusBadge status={p.status} />
                      {p.isDemo && <DemoTag />}
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-dim">Views 30d</p>
                        <p className="tabular text-fog">{formatNumber(s.pageViews)}</p>
                      </div>
                      <div>
                        <p className="text-dim">CTR</p>
                        <p className="tabular text-fog">{formatPercent(s.pageViews ? clicks / s.pageViews : 0)}</p>
                      </div>
                      <div>
                        <p className="text-dim">Conv.</p>
                        <p className="tabular text-fog">{formatNumber(s.conversions)}</p>
                      </div>
                      <div>
                        <p className="text-dim">Earnings</p>
                        <p className="tabular text-fog">{formatMoney(p.businessModel === "AFFILIATE" ? s.commission : s.revenue, p.currency)}</p>
                      </div>
                    </div>
                    {decisions[i] && (
                      <p className="mt-3 text-xs text-haze">
                        <Badge tone={decisions[i]!.decision === "SCALE" ? "good" : "info"}>{decisions[i]!.decision.replace("_", " ").toLowerCase()}</Badge> <span className="ms-1">{decisions[i]!.reasons[0]}</span>
                      </p>
                    )}
                  </div>
                </div>
                {canRun && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-edge pt-4">
                    <ActionForm action={enqueueJobAction} className="inline-block">
                      <input type="hidden" name="job" value="content_generation" />
                      <input type="hidden" name="productId" value={p.id} />
                      <input type="hidden" name="batch" value="scale" />
                      <SubmitButton size="sm" pendingText="Queuing…">Scale content (winning angle ×15)</SubmitButton>
                    </ActionForm>
                    {p.status === "WINNER" && (
                      <ActionForm action={setStatusAction} className="inline-block">
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="status" value="SCALING" />
                        <SubmitButton size="sm" variant="secondary">
                          Mark as scaling
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Trophy} title="No winners yet">
          Winners appear when a test clears the winner thresholds.
        </EmptyState>
      )}
    </>
  );
}
