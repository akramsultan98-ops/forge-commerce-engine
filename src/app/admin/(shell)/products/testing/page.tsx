import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { can } from "@/lib/rbac";
import { formatDate, formatNumber, formatPercent } from "@/lib/utils";
import { formatMoney } from "@/domain/money";
import { pageContext } from "@/server/auth/session";
import { getSetting } from "@/server/settings";
import { listTests } from "@/server/services/testing";
import { productStats } from "@/server/services/analytics";
import { Badge, ButtonLink, Callout, DemoTag, EmptyState, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/admin/forms";
import { evaluateTestAction } from "../../../actions/products";

export const metadata = { title: "Testing" };

const verdictTone = (v: string | null) => (v === "WINNER" ? "good" : v === "FAILURE" ? "critical" : v === "PROMISING" ? "info" : "neutral") as "good" | "critical" | "info" | "neutral";
const decisionTone = (d: string | null) => (d === "SCALE" ? "good" : d === "KILL" ? "critical" : d === "PAUSE" ? "warning" : "info") as "good" | "critical" | "warning" | "info";

export default async function TestingPage() {
  const ctx = await pageContext("products:read");
  const [running, completed, t] = await Promise.all([listTests(ctx, { status: "RUNNING" }), listTests(ctx, { status: "COMPLETED" }), getSetting(ctx, "testing.thresholds")]);
  const stats = await Promise.all(running.map((r) => productStats(ctx, r.test.productId, r.test.startedAt)));
  const canRun = can(ctx.role, "products:write");

  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Product testing"
        description={`Every product under test runs for ${t.minDays}–${t.maxDays} days and needs ${t.minPageViews} page views before a verdict. Thresholds are configurable in Settings.`}
        actions={
          canRun && (
            <ActionForm action={evaluateTestAction} className="inline-block">
              <SubmitButton pendingText="Evaluating…">Evaluate all tests</SubmitButton>
            </ActionForm>
          )
        }
      />
      <Callout className="mb-6" title="How verdicts are decided">
        <span className="text-xs">
          <strong className="text-fog">Winner</strong>: click-through ≥ {formatPercent(t.winner.minAffiliateCtr)} and conversion ≥ {formatPercent(t.winner.minConversionRate, 2)} with positive economics (ROI ≥ {formatPercent(t.winner.minRoi, 0)} when there is spend). <strong className="text-fog">Failure</strong>: click-through ≤{" "}
          {formatPercent(t.failure.maxAffiliateCtr, 1)} and conversion ≤ {formatPercent(t.failure.maxConversionRate, 2)}, or no demand by day {t.maxDays}. Everything else is <strong className="text-fog">Promising</strong> or needs more data. Decisions: Scale · Test more · Optimize · Content more · Pause · Kill — winners are promoted automatically; kills are recommended for you to confirm.
        </span>
      </Callout>
      <Panel title={`Running (${running.length})`} bodyClassName="p-0">
        {running.length ? (
          <Table minWidth={1100}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th align="end">Day</Th>
                <Th align="end">Views</Th>
                <Th align="end">CTR</Th>
                <Th align="end">Conv.</Th>
                <Th align="end">Earnings</Th>
                <Th>Verdict</Th>
                <Th>Decision</Th>
                <Th align="end" />
              </tr>
            </thead>
            <tbody>
              {running.map((r, i) => {
                const s = stats[i];
                const clicks = s.affiliateClicks + s.productClicks;
                const day = Math.floor((Date.now() - r.test.startedAt.getTime()) / 86400_000);
                return (
                  <tr key={r.test.id}>
                    <Td>
                      <Link href={`/admin/products/${r.test.productId}?tab=analytics`} className="text-fog hover:underline">
                        {r.title}
                      </Link>{" "}
                      {r.isDemo && <DemoTag />}
                      <p className="text-[11px] text-dim">{r.businessModel.toLowerCase()} · started {formatDate(r.test.startedAt)}</p>
                    </Td>
                    <Td align="end">
                      {day}/{r.test.plannedDays}
                    </Td>
                    <Td align="end">{formatNumber(s.pageViews)}</Td>
                    <Td align="end">{formatPercent(s.pageViews ? clicks / s.pageViews : 0)}</Td>
                    <Td align="end">{formatPercent(s.pageViews ? s.conversions / s.pageViews : 0, 2)}</Td>
                    <Td align="end">{formatMoney(r.businessModel === "AFFILIATE" ? s.commission : s.revenue, "USD")}</Td>
                    <Td>{r.test.verdict ? <Badge tone={verdictTone(r.test.verdict)}>{r.test.verdict.toLowerCase().replace("_", " ")}</Badge> : <span className="text-xs text-dim">not evaluated</span>}</Td>
                    <Td>
                      {r.test.decision ? <Badge tone={decisionTone(r.test.decision)}>{r.test.decision.replace("_", " ").toLowerCase()}</Badge> : "—"}
                      {r.test.reasons?.[0] && <p className="mt-1 max-w-64 text-[11px] text-dim">{r.test.reasons[0]}</p>}
                    </Td>
                    <Td align="end">
                      {canRun && (
                        <ActionForm action={evaluateTestAction}>
                          <input type="hidden" name="testId" value={r.test.id} />
                          <SubmitButton size="sm" variant="secondary">
                            Evaluate
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={FlaskConical} title="No running tests" action={<ButtonLink href="/admin/dashboard">Pick an opportunity</ButtonLink>}>
              Start a test from a product’s command center.
            </EmptyState>
          </div>
        )}
      </Panel>
      <Panel className="mt-6" title={`Completed (${completed.length})`} bodyClassName="p-0">
        {completed.length ? (
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Ran</Th>
                <Th>Verdict</Th>
                <Th>Decision</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {completed.map((r) => (
                <tr key={r.test.id}>
                  <Td>
                    <Link href={`/admin/products/${r.test.productId}`} className="text-fog hover:underline">
                      {r.title}
                    </Link>
                  </Td>
                  <Td className="text-xs">
                    {formatDate(r.test.startedAt)} → {r.test.endedAt ? formatDate(r.test.endedAt) : "—"}
                  </Td>
                  <Td>{r.test.verdict ? <Badge tone={verdictTone(r.test.verdict)}>{r.test.verdict.toLowerCase().replace("_", " ")}</Badge> : "—"}</Td>
                  <Td>{r.test.decision ? <Badge tone={decisionTone(r.test.decision)}>{r.test.decision.replace("_", " ").toLowerCase()}</Badge> : "—"}</Td>
                  <Td className="max-w-md text-xs">{r.test.reasons.join(" · ")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState title="No completed tests yet" />
          </div>
        )}
      </Panel>
    </>
  );
}
