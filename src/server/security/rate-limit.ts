// Fixed-window-with-sliding-estimate rate limiter (in-process).
// Good for a single instance; for horizontally scaled deployments swap `store` for Redis — the
// interface is intentionally tiny (see docs/SECURITY.md).

type Bucket = { count: number; prevCount: number; windowStart: number };
const store = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (now - lastSweep > 60_000) sweep(now, windowMs);
  let b = store.get(key);
  if (!b) {
    b = { count: 0, prevCount: 0, windowStart: now };
    store.set(key, b);
  }
  const elapsed = now - b.windowStart;
  if (elapsed >= windowMs) {
    b.prevCount = elapsed >= 2 * windowMs ? 0 : b.count;
    b.count = 0;
    b.windowStart = now - (elapsed % windowMs);
  }
  // Sliding-window estimate: weight the previous window by how much of it still overlaps.
  const overlap = 1 - (now - b.windowStart) / windowMs;
  const estimated = b.count + b.prevCount * Math.max(0, overlap);
  if (estimated >= limit) {
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((b.windowStart + windowMs - now) / 1000)) };
  }
  b.count++;
  return { ok: true, remaining: Math.max(0, Math.floor(limit - estimated - 1)), retryAfterSeconds: 0 };
}

function sweep(now: number, windowMs: number) {
  lastSweep = now;
  for (const [k, b] of store) if (now - b.windowStart > 2 * Math.max(windowMs, 60_000)) store.delete(k);
}

export function resetRateLimits() {
  store.clear();
}

export const LIMITS = {
  login: { limit: 8, windowMs: 15 * 60_000 },
  api: { limit: 240, windowMs: 60_000 },
  track: { limit: 120, windowMs: 60_000 },
  redirect: { limit: 60, windowMs: 60_000 },
  newsletter: { limit: 5, windowMs: 60 * 60_000 },
  webhook: { limit: 600, windowMs: 60_000 },
  command: { limit: 30, windowMs: 60_000 },
} as const;
