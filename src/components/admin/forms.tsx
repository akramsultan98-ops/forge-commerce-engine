"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { btn } from "./styles";

type State = { ok: boolean; message?: string; error?: string; data?: Record<string, unknown> } | null;
type Action = (prev: State, fd: FormData) => Promise<State>;

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}

export function SubmitButton({ children, pendingText, variant = "primary", size = "md", className, confirm, name, value }: { children: React.ReactNode; pendingText?: string; variant?: Parameters<typeof btn>[0]; size?: Parameters<typeof btn>[1]; className?: string; confirm?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn(btn(variant, size), className)}
    >
      {pending && <Spinner />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** A form bound to a server action with inline success/error feedback and optional job watching. */
export function ActionForm({ action, children, className, resetOnSuccess = false, refresh = true }: { action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; refresh?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      if (refresh) router.refresh();
    }
  }, [state, resetOnSuccess, refresh, router]);
  const jobId = typeof state?.data?.jobId === "number" ? (state.data.jobId as number) : null;
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state && (
        <p role={state.ok ? "status" : "alert"} className={cn("mt-2 text-xs", state.ok ? "text-haze" : "text-[#ff9b9b]")}>
          <span aria-hidden className={cn("me-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle", state.ok ? "bg-good" : "bg-critical")} />
          {state.ok ? state.message ?? "Done." : state.error}
        </p>
      )}
      {jobId !== null && <JobWatcher jobId={jobId} />}
    </form>
  );
}

type JobView = { status: string; type: string; lastError: string | null; attempts: number };

/** Polls a background job and refreshes the page when it finishes. */
export function JobWatcher({ jobId }: { jobId: number }) {
  const [job, setJob] = useState<JobView | null>(null);
  const router = useRouter();
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/v1/jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as { data: JobView };
          if (stop) return;
          setJob(json.data);
          if (["succeeded", "failed", "cancelled"].includes(json.data.status)) {
            router.refresh();
            return;
          }
        }
      } catch {
        /* keep polling */
      }
      if (!stop) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId, router]);
  if (!job) return <p className="mt-1 flex items-center gap-2 text-xs text-dim"><Spinner /> Job #{jobId} queued…</p>;
  const done = job.status === "succeeded";
  const failed = job.status === "failed";
  return (
    <p className="mt-1 flex items-center gap-2 text-xs text-haze" role="status">
      {!done && !failed && <Spinner />}
      <span aria-hidden className={cn("inline-block h-1.5 w-1.5 rounded-full", done ? "bg-good" : failed ? "bg-critical" : "bg-s1")} />
      Job #{jobId} · {job.type.replace(/_/g, " ")} · {job.status}
      {failed && job.lastError ? ` — ${job.lastError.slice(0, 160)}` : ""}
    </p>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={btn("ghost", "sm")}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
