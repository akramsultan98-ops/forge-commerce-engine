// Admin (dark) UI primitives — server components, no client state.

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Archive, BadgeCheck, Brain, CircleDot, CirclePause, CircleX, FlaskConical, Gauge, Info, Minus, Pencil, Radar, Search, Sparkles, TrendingUp, TriangleAlert, Trophy, WandSparkles } from "lucide-react";
import type { ProductStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { btn, inputCls, labelCls, textareaCls, type BtnSize, type BtnVariant } from "./styles";

export { btn };

export function PageHeader({ eyebrow, title, description, actions, children }: { eyebrow?: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-5 border-b border-edge pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2 text-dim">{eyebrow}</p>}
        <h1 className="text-[26px] font-semibold tracking-tight text-fog">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-sm leading-relaxed text-haze">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, subtitle, actions, children, className, bodyClassName, id }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cn("min-w-0 rounded-lg border border-edge bg-panel", className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b border-edge px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-medium text-fog">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-dim">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function ButtonLink({ href, children, variant = "secondary", size = "md", className, external }: { href: string; children: React.ReactNode; variant?: BtnVariant; size?: BtnSize; className?: string; external?: boolean }) {
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(btn(variant, size), className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cn(btn(variant, size), className)}>
      {children}
    </Link>
  );
}

export type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical" | "ai";
const TONE_MARK: Record<Tone, string> = {
  neutral: "text-dim",
  info: "text-s1",
  good: "text-good",
  warning: "text-warning",
  serious: "text-serious",
  critical: "text-critical",
  ai: "text-s7",
};

export function Badge({ tone = "neutral", icon: Icon, children, title, className }: { tone?: Tone; icon?: LucideIcon; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-edge-2 bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-haze", className)}>
      {Icon ? <Icon aria-hidden className={cn("h-3 w-3", TONE_MARK[tone])} strokeWidth={2.25} /> : <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full bg-current", TONE_MARK[tone])} />}
      {children}
    </span>
  );
}

const STATUS_META: Record<ProductStatus, { tone: Tone; icon: LucideIcon; label: string }> = {
  DISCOVERED: { tone: "neutral", icon: Sparkles, label: "Discovered" },
  RESEARCHING: { tone: "neutral", icon: Search, label: "Researching" },
  APPROVED: { tone: "info", icon: BadgeCheck, label: "Approved" },
  TESTING: { tone: "info", icon: FlaskConical, label: "Testing" },
  WINNER: { tone: "good", icon: Trophy, label: "Winner" },
  SCALING: { tone: "good", icon: TrendingUp, label: "Scaling" },
  PAUSED: { tone: "warning", icon: CirclePause, label: "Paused" },
  KILLED: { tone: "critical", icon: CircleX, label: "Killed" },
  ARCHIVED: { tone: "neutral", icon: Archive, label: "Archived" },
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const m = STATUS_META[status];
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {m.label}
    </Badge>
  );
}

const PROV_META: Record<string, { tone: Tone; icon: LucideIcon; label: string; title: string }> = {
  REAL: { tone: "good", icon: Radar, label: "Live", title: "REAL — fetched from an official API or verified feed" },
  ESTIMATED: { tone: "neutral", icon: Gauge, label: "Estimate", title: "ESTIMATED — derived by a formula from other data" },
  AI_INFERENCE: { tone: "ai", icon: Brain, label: "AI", title: "AI_INFERENCE — an AI model's judgement, not a measurement" },
  MANUAL: { tone: "neutral", icon: Pencil, label: "Manual", title: "MANUAL — entered by an operator" },
  DEMO: { tone: "warning", icon: CircleDot, label: "Demo", title: "DEMO — seed/demo data, not a real observation" },
  MISSING: { tone: "neutral", icon: Minus, label: "No data", title: "No data — factor held at neutral" },
};

export function ProvenanceBadge({ p, compact }: { p: string | null | undefined; compact?: boolean }) {
  const m = PROV_META[p ?? "MISSING"] ?? PROV_META.MISSING;
  return (
    <Badge tone={m.tone} icon={m.icon} title={m.title} className={compact ? "px-1.5" : undefined}>
      {compact ? <span className="sr-only">{m.label}</span> : m.label}
    </Badge>
  );
}

export function EngineBadge({ method, model }: { method: string | null | undefined; model?: string | null }) {
  if (!method) return null;
  if (method === "AI") return <Badge tone="ai" icon={WandSparkles} title={model ?? undefined}>AI{model ? ` · ${model}` : ""}</Badge>;
  if (method === "TEMPLATE") return <Badge tone="neutral" icon={Pencil} title="Deterministic template engine (no AI call)">Template</Badge>;
  return <Badge>Manual</Badge>;
}

export function DemoTag() {
  return (
    <Badge tone="warning" icon={CircleDot} title="Demo seed data">
      Demo
    </Badge>
  );
}

export function Callout({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "critical"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const Icon = tone === "info" ? Info : TriangleAlert;
  return (
    <div role={tone === "info" ? "note" : "alert"} className={cn("flex gap-3 rounded-lg border border-edge-2 bg-panel-2 p-4 text-sm", className)}>
      <Icon aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "info" ? "text-s1" : tone === "warning" ? "text-warning" : "text-critical")} />
      <div className="min-w-0 text-haze">
        {title && <p className="mb-1 font-medium text-fog">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function SetupState({ title, requirements, docsUrl, children }: { title: string; requirements: string[]; docsUrl?: string; children?: React.ReactNode }) {
  return (
    <Callout tone="warning" title={`${title} — not connected`}>
      <p className="mb-2">FORGE never fakes this connection. To enable it, provide:</p>
      <ul className="list-disc space-y-1 ps-5 text-xs">
        {requirements.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {docsUrl && (
        <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-fog underline decoration-edge-2 underline-offset-4 hover:decoration-fog">
          Official documentation ↗
        </a>
      )}
      {children}
    </Callout>
  );
}

export function EmptyState({ icon: Icon = Sparkles, title, children, action }: { icon?: LucideIcon; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-edge-2 px-6 py-14 text-center">
      <Icon aria-hidden className="mb-3 h-6 w-6 text-dim" />
      <p className="text-sm font-medium text-fog">{title}</p>
      {children && <div className="mt-1 max-w-md text-xs text-dim">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ children, minWidth = 640 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-edge scrollbar-thin">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, align = "start" }: { children?: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return <th className={cn("whitespace-nowrap border-b border-edge bg-panel-2 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wider text-dim", align === "end" && "text-end", align === "center" && "text-center", className)}>{children}</th>;
}

export function Td({ children, className, align = "start" }: { children?: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return <td className={cn("border-b border-edge px-4 py-3 align-middle text-haze", align === "end" && "tabular text-end", align === "center" && "text-center", className)}>{children}</td>;
}

export function Tabs({ items }: { items: Array<{ href: string; label: string; active: boolean; count?: number }> }) {
  return (
    <nav aria-label="Sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-edge scrollbar-thin">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors", it.active ? "border-fog text-fog" : "border-transparent text-dim hover:text-haze")}
        >
          {it.label}
          {it.count !== undefined && <span className="tabular ms-2 rounded bg-panel-2 px-1.5 py-0.5 text-[11px] text-dim">{it.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Field({ label, hint, children, htmlFor, className }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-dim">{hint}</p>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(inputCls, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(textareaCls, props.className)} />;
}

export function Select({ options, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select {...props} className={cn(inputCls, "pe-8", className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function KeyValue({ items, className }: { items: Array<{ k: React.ReactNode; v: React.ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wider text-dim">{it.k}</dt>
          <dd className="mt-1 text-sm text-fog">{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <code className={cn("break-all rounded bg-night px-1.5 py-0.5 font-mono text-[12px] text-haze", className)}>{children}</code>;
}
