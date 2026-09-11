"use client";

// Single-series time chart with a metric switcher (never a dual axis), crosshair + tooltip on
// hover AND keyboard, an endpoint direct label and a table-view twin. Specs: 2px line, 10% area
// wash, hairline solid grid, 8px end marker with a 2px surface ring.

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface SeriesPoint {
  date: string;
  values: Record<string, number>;
}

export interface MetricDef {
  key: string;
  label: string;
  kind: "count" | "currency" | "percent";
  currency?: string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

function format(v: number, m: MetricDef, compact = false): string {
  const opts: Intl.NumberFormatOptions =
    m.kind === "currency"
      ? { style: "currency", currency: m.currency ?? "USD", maximumFractionDigits: compact || v >= 100 ? 0 : 2, notation: compact ? "compact" : "standard" }
      : m.kind === "percent"
        ? { style: "percent", maximumFractionDigits: 1 }
        : { maximumFractionDigits: 0, notation: compact ? "compact" : "standard" };
  return new Intl.NumberFormat("en-US", opts).format(v);
}

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function TimeSeriesChart({ points, metrics, height = 240, title }: { points: SeriesPoint[]; metrics: MetricDef[]; height?: number; title: string }) {
  const [metricKey, setMetricKey] = useState(metrics[0]?.key);
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(640);
  const ref = useRef<HTMLDivElement>(null);
  const tableId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];
  const values = useMemo(() => points.map((p) => p.values[metric.key] ?? 0), [points, metric.key]);
  const max = niceMax(Math.max(0, ...values));
  const pad = { l: 48, r: 64, t: 14, b: 28 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const n = values.length;
  const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = n ? `${line}L${x(n - 1).toFixed(1)},${pad.t + ih}L${x(0).toFixed(1)},${pad.t + ih}Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 84))));
  const total = values.reduce((s, v) => s + v, 0);
  const shown = active ?? null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const idx = Math.round(((px - pad.l) / Math.max(1, iw)) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, idx)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (!n) return;
    if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? n - 1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n - 1) - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  return (
    <div dir="ltr">
      {metrics.length > 1 && (
        <div role="tablist" aria-label="Metric" className="mb-4 inline-flex rounded-md border border-edge bg-night p-0.5">
          {metrics.map((m) => (
            <button
              key={m.key}
              role="tab"
              type="button"
              aria-selected={m.key === metric.key}
              onClick={() => setMetricKey(m.key)}
              className={`rounded px-3 py-1 text-xs transition-colors ${m.key === metric.key ? "bg-panel-3 text-fog" : "text-dim hover:text-haze"}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-2xl font-semibold text-fog">{format(total, metric, true)}</span>
        <span className="text-xs text-dim">
          {metric.label.toLowerCase()} · {n} days
        </span>
      </div>
      <div ref={ref} className="relative w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}: ${metric.label} per day. ${n} points, total ${format(total, metric)}. Use arrow keys to read values.`}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          className="block touch-none outline-none focus-visible:ring-2 focus-visible:ring-s1 rounded"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--color-edge-2)" : "var(--color-edge)"} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular" fill="var(--color-dim)" fontSize={11}>
                {format(t, metric, true)}
              </text>
            </g>
          ))}
          {points.map((p, i) =>
            i % every === 0 || i === n - 1 ? (
              <text key={p.date} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fill="var(--color-dim)" fontSize={11}>
                {dayLabel(p.date)}
              </text>
            ) : null,
          )}
          <path d={area} fill="var(--color-s1)" fillOpacity={0.1} />
          <path d={line} fill="none" stroke="var(--color-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {n > 0 && (
            <>
              <circle cx={x(n - 1)} cy={y(values[n - 1])} r={4} fill="var(--color-s1)" stroke="var(--color-panel)" strokeWidth={2} />
              <text x={x(n - 1) + 10} y={y(values[n - 1])} dy="0.32em" fill="var(--color-haze)" fontSize={11} className="tabular">
                {format(values[n - 1], metric, true)}
              </text>
            </>
          )}
          {shown !== null && n > 0 && (
            <g pointerEvents="none">
              <line x1={x(shown)} x2={x(shown)} y1={pad.t} y2={pad.t + ih} stroke="var(--color-edge-2)" strokeWidth={1} />
              <circle cx={x(shown)} cy={y(values[shown])} r={5} fill="var(--color-s1)" stroke="var(--color-panel)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {shown !== null && n > 0 && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 rounded-md border border-edge-2 bg-panel-2 px-3 py-2 text-xs shadow-xl"
            style={{ left: Math.min(Math.max(x(shown) + 12, 0), width - 150), top: Math.max(0, y(values[shown]) - 52) }}
          >
            <div className="text-dim">{dayLabel(points[shown].date)}</div>
            <div className="mt-0.5 flex items-center gap-2 text-fog">
              <span className="inline-block h-2 w-2 rounded-full bg-s1" aria-hidden />
              <span className="font-medium">{format(values[shown], metric)}</span>
              <span className="text-dim">{metric.label.toLowerCase()}</span>
            </div>
          </div>
        )}
      </div>
      <details className="mt-3 text-xs text-dim">
        <summary className="inline-flex items-center gap-1 hover:text-haze" aria-controls={tableId}>
          Table view
        </summary>
        <div id={tableId} className="mt-2 max-h-56 overflow-auto rounded border border-edge scrollbar-thin">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-panel-2 text-dim">
              <tr>
                <th className="px-3 py-1.5 font-medium">Date</th>
                {metrics.map((m) => (
                  <th key={m.key} className="px-3 py-1.5 text-right font-medium">
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular text-haze">
              {points.map((p) => (
                <tr key={p.date} className="border-t border-edge">
                  <td className="px-3 py-1">{p.date}</td>
                  {metrics.map((m) => (
                    <td key={m.key} className="px-3 py-1 text-right">
                      {format(p.values[m.key] ?? 0, m)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
