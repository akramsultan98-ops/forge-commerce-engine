import "server-only";
import { AppError, captureException, ValidationError } from "../errors";

export type ActionState = { ok: boolean; message?: string; error?: string; data?: Record<string, unknown> } | null;

/** Runs a server-action body and converts failures into a form-friendly state (never leaks internals). */
export async function act(fn: () => Promise<string | void | { message?: string; data?: Record<string, unknown> }>): Promise<ActionState> {
  try {
    const r = await fn();
    if (typeof r === "string") return { ok: true, message: r };
    return { ok: true, message: r?.message, data: r?.data };
  } catch (err) {
    if (err instanceof ValidationError) {
      const issues = Array.isArray(err.details) ? (err.details as Array<{ path?: unknown[]; message?: string }>) : [];
      const detail = issues[0] ? `${issues[0].path?.length ? `${issues[0].path.join(".")}: ` : ""}${issues[0].message}` : "";
      return { ok: false, error: detail ? `${err.message} — ${detail}` : err.message };
    }
    if (err instanceof AppError) return { ok: false, error: err.message };
    captureException(err, { component: "server-action" });
    return { ok: false, error: "Something went wrong. The error was logged." };
  }
}

export function formObject(fd: FormData, exclude: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION") || exclude.includes(k) || typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

export const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
