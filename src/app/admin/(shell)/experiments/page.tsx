import Link from "next/link";
import { eq } from "drizzle-orm";
import { Split } from "lucide-react";
import { formatNumber, formatPercent, formatRelative, round } from "@/lib/utils";
import { pageContext } from "@/server/auth/session";
import { products } from "@/server/db/schema";
import { experimentResults, listExperiments } from "@/server/services/experiments";
import { Badge, EmptyState, PageHeader, Panel, Table, Td, Th } from "@/components/admin/ui";

export const metadata = { title: "Experiments" };

export default async function ExperimentsPage() {
  const ctx = await pageContext("analytics:read");
  const exps = await listExperiments(ctx);
  const results = await Promise.all(exps.map((e) => experimentResults(ctx, e)));
  const titles = new Map((await ctx.db.select({ id: products.id, title: products.title }).from(products).where(eq(products.organizationId, ctx.orgId))).map((p) => [p.id, p.title]));
  return (
    <>
      <PageHeader
        eyebrow="Growth"
        title="Experiments"
        description="A/B tests on headline, hero image, CTA, price, angle, page structure, offer and video hook. Variants are assigned per visitor (consented) or per page view, and carried into the tracked click — no extra cookies required. Significance: two-proportion z-test, α = 0.05, ≥ 30 impressions per arm."
      />
      {exps.length ? (
        <div className="space-y-6">
          {exps.map((e, i) => (
            <Panel
              key={e.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {e.name}
                  <Badge tone={e.status === "RUNNING" ? "info" : e.status === "COMPLETED" ? "good" : "neutral"}>{e.status.toLowerCase()}</Badge>
                  <Badge>{e.type.replace("_", " ").toLowerCase()}</Badge>
                </span>
              }
              subtitle={
                <>
                  {e.productId && (
                    <Link href={`/admin/products/${e.productId}?tab=experiments`} className="hover:text-haze">
                      {titles.get(e.productId)}
                    </Link>
                  )}{" "}
                  · started {e.startedAt ? formatRelative(e.startedAt) : "—"} {e.hypothesis ? `· ${e.hypothesis}` : ""}
                </>
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
                    <Th align="end">Lift</Th>
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
                      <Td align="end">{v.vsControl && v.vsControl.lift !== null ? `${v.vsControl.lift >= 0 ? "+" : ""}${formatPercent(v.vsControl.lift)}` : "—"}</Td>
                      <Td align="end">{v.vsControl ? `${round(v.vsControl.pValue, 3)}${v.vsControl.significant ? " ✓" : ""}` : "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          ))}
        </div>
      ) : (
        <EmptyState icon={Split} title="No experiments yet">
          Start one from a landing page builder or a product’s Experiments tab.
        </EmptyState>
      )}
    </>
  );
}
