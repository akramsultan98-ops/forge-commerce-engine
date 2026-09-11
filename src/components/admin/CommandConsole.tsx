"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { btn } from "./styles";
import { JobWatcher, Spinner } from "./forms";

type Result = {
  intent: string;
  engine: string;
  reply: string;
  products?: Array<{ id: string; title: string; score: number | null; price: number | null; currency: string; status: string; note?: string; isDemo: boolean }>;
  job?: { id: number; type: string; deduped: boolean };
  links?: Array<{ label: string; href: string }>;
};
type State = { ok: boolean; message?: string; error?: string; data?: Record<string, unknown> } | null;

export function CommandConsole({ action, examples, compact = false }: { action: (prev: State, fd: FormData) => Promise<State>; examples: string[]; compact?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  const [history, setHistory] = useState<Array<{ q: string; result: Result | null; error?: string }>>([]);
  const [q, setQ] = useState("");
  const lastQ = useRef("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state) return;
    const result = (state.data?.result as Result | undefined) ?? null;
    setHistory((h) => [{ q: lastQ.current, result, error: state.ok ? undefined : state.error }, ...h].slice(0, compact ? 1 : 12));
  }, [state, compact]);

  return (
    <div>
      <form
        ref={formRef}
        action={(fd) => {
          lastQ.current = String(fd.get("q") ?? "");
          setQ("");
          formAction(fd);
        }}
        className="flex items-center gap-2 rounded-lg border border-edge-2 bg-night p-1.5 focus-within:border-s1"
      >
        <Terminal aria-hidden className="ms-2 h-4 w-4 shrink-0 text-dim" />
        <label htmlFor="forge-command" className="sr-only">
          Command
        </label>
        <input
          id="forge-command"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find me 10 products under $30 with strong TikTok potential…"
          autoComplete="off"
          maxLength={500}
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-fog placeholder:text-dim outline-none"
        />
        <button type="submit" disabled={pending || !q.trim()} className={btn("primary", "sm")}>
          {pending ? <Spinner /> : <ArrowRight aria-hidden className="h-3.5 w-3.5 rtl:rotate-180" />}
          Run
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.slice(0, compact ? 4 : examples.length).map((ex) => (
          <button key={ex} type="button" onClick={() => setQ(ex)} className="rounded-full border border-edge-2 px-2.5 py-1 text-[11px] text-haze transition-colors hover:border-dim hover:text-fog">
            {ex}
          </button>
        ))}
      </div>
      <div className="mt-5 space-y-4" aria-live="polite">
        {history.map((h, i) => (
          <article key={i} className={cn("rounded-lg border border-edge bg-panel p-4", i > 0 && "opacity-70")}>
            <p className="mb-2 font-mono text-xs text-dim">› {h.q}</p>
            {h.error && <p className="text-sm text-[#ff9b9b]">{h.error}</p>}
            {h.result && (
              <>
                <div className="mb-2 flex items-center gap-2 text-[11px] text-dim">
                  <span className="rounded border border-edge-2 px-1.5 py-0.5">{h.result.intent.replace(/_/g, " ").toLowerCase()}</span>
                  <span>via {h.result.engine === "AI" ? "AI intent model" : "rule parser"}</span>
                </div>
                <p className="whitespace-pre-line text-sm leading-relaxed text-haze">{h.result.reply}</p>
                {!!h.result.products?.length && (
                  <ul className="mt-3 divide-y divide-edge rounded-md border border-edge">
                    {h.result.products.map((p) => (
                      <li key={p.id}>
                        <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-panel-2">
                          <span className="tabular w-10 shrink-0 text-end font-semibold text-fog">{p.score === null ? "—" : Math.round(p.score)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-fog">
                              {p.title}
                              {p.isDemo && <span className="ms-2 text-[10px] uppercase tracking-wider text-warning">demo</span>}
                            </span>
                            {p.note && <span className="block truncate text-xs text-dim">{p.note}</span>}
                          </span>
                          <span className="hidden text-xs text-dim sm:block">{p.status.toLowerCase()}</span>
                          <ArrowUpRight aria-hidden className="h-3.5 w-3.5 text-dim" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {h.result.job && i === 0 && <JobWatcher jobId={h.result.job.id} />}
                {!!h.result.links?.length && (
                  <div className="mt-3 flex flex-wrap gap-3">
                    {h.result.links.map((l) => (
                      <Link key={l.href} href={l.href} className="text-xs text-fog underline decoration-edge-2 underline-offset-4 hover:decoration-fog">
                        {l.label} →
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
