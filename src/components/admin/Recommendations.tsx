import Link from "next/link";
import { Lightbulb, WandSparkles } from "lucide-react";
import type { Recommendation } from "@/server/db/schema";
import { ActionForm, SubmitButton } from "./forms";
import { Badge, EmptyState } from "./ui";
import { recommendationAction } from "@/app/admin/actions/products";

export function RecommendationList({ items, canAct }: { items: Array<{ rec: Recommendation; productTitle: string | null }>; canAct: boolean }) {
  if (!items.length) {
    return (
      <EmptyState icon={Lightbulb} title="No open recommendations">
        Recommendations appear once products have traffic, tests or content data to reason about.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-edge">
      {items.map(({ rec, productTitle }) => (
        <li key={rec.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Badge tone={rec.priority === "HIGH" ? "serious" : rec.priority === "MEDIUM" ? "info" : "neutral"}>{rec.priority.toLowerCase()} priority</Badge>
              {rec.source === "AI" && (
                <Badge tone="ai" icon={WandSparkles}>
                  AI
                </Badge>
              )}
              {productTitle && rec.productId && (
                <Link href={`/admin/products/${rec.productId}`} className="truncate text-xs text-dim hover:text-haze">
                  {productTitle}
                </Link>
              )}
            </div>
            <p className="text-sm font-medium text-fog">{rec.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-haze">{rec.body}</p>
            {Object.keys(rec.evidence ?? {}).length > 0 && (
              <p className="mt-1.5 font-mono text-[11px] text-dim">
                {Object.entries(rec.evidence)
                  .slice(0, 4)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" · ")}
              </p>
            )}
          </div>
          {canAct && (
            <div className="flex shrink-0 flex-col items-stretch gap-2 md:w-48">
              <ActionForm action={recommendationAction}>
                <input type="hidden" name="id" value={rec.id} />
                <SubmitButton size="sm" variant="secondary" className="w-full" pendingText="Working…">
                  {rec.action?.label ?? "Mark done"}
                </SubmitButton>
              </ActionForm>
              <ActionForm action={recommendationAction}>
                <input type="hidden" name="id" value={rec.id} />
                <input type="hidden" name="mode" value="dismiss" />
                <SubmitButton size="sm" variant="ghost" className="w-full">
                  Dismiss
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
