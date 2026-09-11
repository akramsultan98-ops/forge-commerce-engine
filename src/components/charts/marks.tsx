// Server-renderable chart marks: sparkline, bar list, ordinal funnel, score meter/ring, stat tile.
// Bars: single series → slot-1 blue for every bar (never a value ramp), ≤ 24px thick, 4px rounded
// data-end, square at the baseline. Funnel stages use the validated ordinal blue ramp.
// Text always wears text tokens; hover/focus tooltips enhance but never gate (values are printed).

import { cn } from "@/lib/utils";

export function Sparkline({ values, width = 112, height = 32, label }: { values: number[]; width?: number; height?: number; label?: string }) {
  if (values.length < 2) return <div style={{ width, height }} aria-hidden />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values.map((v, i) => [2 + (i / (values.length - 1)) * (width - 8), 3 + (1 - (v - min) / span) * (height - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={label ?? `Trend over ${values.length} points`} className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke="var(--color-dim)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={3.5} fill="var(--color-s1)" stroke="var(--color-panel)" strokeWidth={2} />
    </svg>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  display: string;
  detail?: string;
}

export function BarList({ rows, emptyText = "No data yet", labelWidth = "8.5rem" }: { rows: BarRow[]; emptyText?: string; labelWidth?: string }) {
  if (!rows.length) return <p className="py-6 text-center text-xs text-dim">{emptyText}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-1">
      {rows.map((r) => {
        const pct = (r.value / max) * 100;
        return (
          <li key={r.key} tabIndex={0} className="group relative grid items-center gap-3 rounded px-1 py-1.5 outline-none hover:bg-panel-2 focus-visible:bg-panel-2" style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr) auto` }}>
            <span className="truncate text-xs text-haze" title={r.label}>
              {r.label}
            </span>
            <span className="flex h-3 items-center">
              <span className="block h-2 rounded-e-[4px] bg-s1" style={{ width: `${r.value > 0 ? Math.max(pct, 1.5) : 0}%` }} />
            </span>
            <span className="tabular text-xs text-fog">{r.display}</span>
            {r.detail && (
              <span role="tooltip" className="pointer-events-none absolute -top-8 end-2 z-10 hidden whitespace-nowrap rounded-md border border-edge-2 bg-panel-3 px-2 py-1 text-[11px] text-fog shadow-lg group-hover:block group-focus-visible:block">
                {r.detail}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const RAMP = ["bg-b250", "bg-b350", "bg-b450", "bg-b550"];

export function Funnel({ stages }: { stages: Array<{ label: string; value: number; display?: string }> }) {
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <ol className="space-y-3">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const rate = prev ? s.value / prev : null;
        return (
          <li key={s.label} tabIndex={0} className="group relative outline-none">
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-haze">{s.label}</span>
              <span className="tabular text-fog">
                {s.display ?? s.value.toLocaleString("en-US")}
                {rate !== null && <span className="ms-2 text-dim">{(rate * 100).toFixed(rate < 0.1 ? 1 : 0)}% of previous</span>}
              </span>
            </div>
            <div className="h-5">
              <div className={cn("h-5 rounded-e-[4px]", RAMP[Math.min(i, RAMP.length - 1)])} style={{ width: `${s.value > 0 ? Math.max((s.value / max) * 100, 1) : 0}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ScoreMeter({ value, className }: { value: number | null; className?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full rounded-full bg-b800", className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-label="Score">
      <div className="h-full rounded-full bg-s1" style={{ width: `${v}%` }} />
    </div>
  );
}

export function ScoreRing({ value, size = 120, caption }: { value: number | null; size?: number; caption?: string }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Score ${value ?? "not scored"} out of 100`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-b800)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-s1)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} />
      </svg>
      <div className="absolute text-center">
        <div className="text-3xl font-semibold leading-none text-fog">{value === null ? "—" : Math.round(value)}</div>
        {caption && <div className="mt-1 text-[10px] uppercase tracking-wider text-dim">{caption}</div>}
      </div>
    </div>
  );
}

/** Stat tile: label · value · signed delta vs a named period (direction × whether up is good) · sparkline. */
export function StatTile({
  label,
  value,
  delta,
  upIsGood = true,
  period = "vs previous period",
  spark,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  upIsGood?: boolean;
  period?: string;
  spark?: number[];
  hint?: string;
}) {
  const hasDelta = delta !== null && delta !== undefined && Number.isFinite(delta);
  const up = hasDelta && delta! > 0;
  const flat = hasDelta && Math.abs(delta!) < 0.005;
  const good = flat ? null : up === upIsGood;
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-edge bg-panel p-4" title={hint}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-haze">{label}</span>
        {spark && <Sparkline values={spark} label={`${label} trend`} />}
      </div>
      <div>
        <div className="truncate text-[26px] font-semibold leading-none tracking-tight text-fog">{value}</div>
        {hasDelta && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px]">
            <span aria-hidden className={cn("inline-block h-0 w-0 border-x-[4px] border-x-transparent", flat ? "h-[2px] w-2 bg-dim" : up ? "border-b-[6px]" : "border-t-[6px]", good === true ? "border-b-good border-t-good" : good === false ? "border-b-critical border-t-critical" : "")} />
            <span className="tabular text-fog">
              {up ? "+" : ""}
              {(delta! * 100).toFixed(Math.abs(delta!) < 0.1 ? 1 : 0)}%
            </span>
            <span className="text-dim">{period}</span>
          </div>
        )}
      </div>
    </div>
  );
}
