"use client";

import { useActionState, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/** First-party page-view beacon. Sends a visitor id only when the visitor consented. */
export function Tracker({ productId, landingPageId, experimentId, variant }: { productId?: string; landingPageId?: string; experimentId?: string; variant?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  useEffect(() => {
    const utm: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = search.get(k);
      if (v) utm[k] = v;
    }
    const body = JSON.stringify({ type: productId ? "PRODUCT_VIEW" : "PAGE_VIEW", path: pathname, productId, landingPageId, experimentId, variant, utm, referrer: document.referrer || null });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/track", blob)) void fetch("/api/track", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => undefined);
  }, [pathname, search, productId, landingPageId, experimentId, variant]);
  return null;
}

const readConsentChoice = () => document.cookie.split("; ").some((c) => c.startsWith("forge_consent="));
const noSubscription = () => () => {};

export function CookieBanner({ text, accept, decline, more, onChoice }: { text: string; accept: string; decline: string; more: string; onChoice: (granted: boolean) => Promise<void> }) {
  // Server snapshot = "already chosen" so SSR never renders the banner (no hydration mismatch).
  const hasChoice = useSyncExternalStore(noSubscription, readConsentChoice, () => true);
  const [dismissed, setDismissed] = useState(false);
  const [pending, start] = useTransition();
  if (hasChoice || dismissed) return null;
  const choose = (g: boolean) =>
    start(async () => {
      await onChoice(g);
      setDismissed(true);
    });
  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie consent" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-line bg-paper/95 p-4 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)] backdrop-blur md:inset-x-auto md:end-6 md:bottom-6">
      <p className="text-sm leading-relaxed text-ink-2">
        {text}{" "}
        <Link href="/legal/cookies" className="underline decoration-line underline-offset-4 hover:decoration-ink">
          {more}
        </Link>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={pending} onClick={() => choose(true)} className="h-9 rounded-full bg-ink px-5 text-sm text-paper transition-opacity hover:opacity-85">
          {accept}
        </button>
        <button type="button" disabled={pending} onClick={() => choose(false)} className="h-9 rounded-full border border-line px-5 text-sm text-ink hover:border-ink">
          {decline}
        </button>
      </div>
    </div>
  );
}

type State = { ok: boolean; message?: string; error?: string } | null;

export function NewsletterForm({ action, placeholder, submit, consent, source, dark = false }: { action: (prev: State, fd: FormData) => Promise<State>; placeholder: string; submit: string; consent: string; source: string; dark?: boolean }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="w-full max-w-lg">
      <input type="hidden" name="source" value={source} />
      <div aria-hidden className="absolute -left-[9999px]">
        <label>
          Company <input name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className={cn("flex items-center gap-2 rounded-full border p-1.5", dark ? "border-white/20 bg-white/5" : "border-line bg-paper")}>
        <label htmlFor={`nl-${source}`} className="sr-only">
          Email
        </label>
        <input id={`nl-${source}`} type="email" name="email" required placeholder={placeholder} autoComplete="email" className={cn("h-10 min-w-0 flex-1 bg-transparent px-4 text-sm outline-none", dark ? "text-paper placeholder:text-white/40" : "text-ink placeholder:text-muted")} />
        <button type="submit" disabled={pending} className={cn("h-10 shrink-0 rounded-full px-5 text-sm font-medium transition-opacity hover:opacity-85 disabled:opacity-60", dark ? "bg-paper text-ink" : "bg-ink text-paper")}>
          {submit}
        </button>
      </div>
      <p role="status" className={cn("mt-2 min-h-5 px-4 text-xs", dark ? "text-white/60" : "text-muted")}>
        {state ? (state.ok ? state.message : state.error) : consent}
      </p>
    </form>
  );
}
