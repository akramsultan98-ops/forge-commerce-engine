type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|access[-_]?token|hmac|signature)/i;

export type Logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
};

/** Recursively masks values whose keys look like secrets so they never reach log sinks. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

function minLevel(): number {
  const lvl = (process.env.LOG_LEVEL as Level | undefined) ?? (process.env.NODE_ENV === "test" ? "warn" : "info");
  return ORDER[lvl] ?? ORDER.info;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  const write = (level: Level, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < minLevel()) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...bindings, ...(meta ? (redact(meta) as object) : {}) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
  return {
    debug: (m, meta) => write("debug", m, meta),
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
    child: (b) => createLogger({ ...bindings, ...b }),
  };
}

export const logger = createLogger({ service: "forge" });
