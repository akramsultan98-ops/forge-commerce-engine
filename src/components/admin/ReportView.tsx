import Link from "next/link";
import type { Top5Entry } from "@/server/services/reports";
import { Badge, DemoTag, KeyValue, Panel, ProvenanceBadge } from "./ui";
import { ScoreRing } from "../charts/marks";

export function ReportView({ entries, note }: { entries: Top5Entry[]; note?: string }) {
  if (!entries.length) return <p className="text-sm text-dim">No eligible products were available for this report.</p>;
  return (
    <div className="space-y-5">
      {note && <p className="text-xs text-dim">{note}</p>}
      {entries.map((e) => (
        <Panel key={e.productId}>
          <div className="flex flex-col gap-5 lg:flex-row">
            <div className="flex shrink-0 items-start gap-4 lg:w-64 lg:flex-col">
              <span className="font-mono text-xs text-dim">#{e.rank}</span>
              <ScoreRing value={e.overallScore} size={96} caption={e.confidence !== null ? `conf ${e.confidence}` : undefined} />
              <div className="flex flex-wrap gap-2">
                <Badge tone={e.verdict === "TEST" ? "good" : e.verdict === "WATCH" ? "info" : e.verdict === "DO_NOT_TEST" ? "critical" : "neutral"}>{e.verdict.replace(/_/g, " ").toLowerCase()}</Badge>
                <Badge tone={e.riskLevel === "HIGH" ? "critical" : e.riskLevel === "MEDIUM" ? "warning" : "neutral"}>risk {String(e.riskLevel).toLowerCase()}</Badge>
                {e.isDemo && <DemoTag />}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <Link href={`/admin/products/${e.productId}`} className="text-lg font-semibold text-fog hover:underline">
                {e.title}
              </Link>
              <p className="text-xs text-dim">{e.category ?? "Uncategorised"}</p>
              <p className="mt-3 text-sm leading-relaxed text-haze">{e.thesis}</p>
              <KeyValue
                className="mt-5 lg:grid-cols-3"
                items={[
                  { k: "Why it's trending", v: e.whyTrending },
                  { k: "Estimated demand", v: e.estimatedDemand },
                  { k: "Estimated competition", v: e.estimatedCompetition },
                  { k: "Supplier cost", v: e.supplierCost },
                  { k: "Suggested price", v: e.suggestedPrice },
                  { k: "Estimated margin", v: e.estimatedMargin },
                  { k: "Affiliate commission", v: e.affiliateCommission },
                  { k: "Content opportunity", v: e.contentOpportunity },
                  { k: "Target customer", v: e.targetCustomer },
                  { k: "Marketing angle", v: e.marketingAngle },
                  { k: "TikTok hook", v: <span className="italic">“{e.tiktokHook}”</span> },
                  { k: "Landing-page angle", v: e.landingAngle },
                  { k: "Recommended action", v: <span className="text-fog">{e.recommendedAction}</span> },
                ]}
              />
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <span className="eyebrow text-dim">Evidence</span>
                {e.sourceEvidence.map((s, i) =>
                  s.url ? (
                    <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-haze underline decoration-edge-2 underline-offset-2 hover:text-fog">
                      <ProvenanceBadge p={s.provenance} compact /> {s.label}
                    </a>
                  ) : (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs text-haze">
                      <ProvenanceBadge p={s.provenance} compact /> {s.label}
                    </span>
                  ),
                )}
              </div>
              <p className="mt-2 text-[11px] text-dim">
                Data mix:{" "}
                {Object.entries(e.provenanceMix)
                  .map(([k, v]) => `${v} ${k.toLowerCase().replace("_", " ")}`)
                  .join(" · ") || "no tracked metrics"}
              </p>
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}
