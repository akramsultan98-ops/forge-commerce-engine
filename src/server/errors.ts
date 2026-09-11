import crypto from "node:crypto";
import { logger } from "./logging/logger";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code = "internal_error",
    public details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, "validation_error", details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "unauthorized");
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super(message, 403, "forbidden");
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Resource") {
    super(`${what} not found`, 404, "not_found");
  }
}
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "conflict");
  }
}
export class RateLimitedError extends AppError {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests — slow down", 429, "rate_limited");
  }
}
/** Thrown when an integration is used without credentials. Carries the exact setup requirements for the UI. */
export class IntegrationNotConfiguredError extends AppError {
  constructor(
    public integration: string,
    public requirements: string[],
  ) {
    super(`${integration} is not connected`, 412, "integration_not_configured", { integration, requirements });
  }
}
/** Thrown when DEMO_MODE blocks an outbound side effect (email, post, order, spend). */
export class DemoModeBlockedError extends AppError {
  constructor(action: string) {
    super(`DEMO_MODE is on — "${action}" was blocked (no real side effects in demo mode)`, 409, "demo_mode_blocked", { action });
  }
}

type Reporter = (err: unknown, context: Record<string, unknown>) => void | Promise<void>;
const reporters: Reporter[] = [];

/** Error-tracking hook: register additional reporters (e.g. an APM SDK) at boot. */
export function registerErrorReporter(r: Reporter) {
  reporters.push(r);
}

function sentryEnvelope(dsn: string, err: unknown, context: Record<string, unknown>) {
  // Minimal Sentry-compatible envelope — avoids pulling a heavy SDK into the core.
  const url = new URL(dsn);
  const projectId = url.pathname.replace(/\//g, "");
  const key = url.username;
  const endpoint = `${url.protocol}//${url.host}/api/${projectId}/envelope/`;
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = crypto.randomUUID().replace(/-/g, "");
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: process.env.NODE_ENV,
    exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: [] } }] },
    extra: context,
  };
  const body = [JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=forge/0.1` },
    body,
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}

export function captureException(err: unknown, context: Record<string, unknown> = {}) {
  if (err instanceof AppError && err.status < 500) return; // expected, user-facing errors
  logger.error(err instanceof Error ? err.message : "unknown error", { err, ...context });
  const dsn = process.env.ERROR_TRACKING_DSN;
  if (dsn) void sentryEnvelope(dsn, err, context);
  for (const r of reporters) {
    try {
      void r(err, context);
    } catch {
      /* reporters must never throw */
    }
  }
}

export function toPublicError(err: unknown): { status: number; body: { error: { code: string; message: string; details?: unknown } } } {
  if (err instanceof AppError) return { status: err.status, body: { error: { code: err.code, message: err.message, details: err.details } } };
  return { status: 500, body: { error: { code: "internal_error", message: "Something went wrong" } } };
}
