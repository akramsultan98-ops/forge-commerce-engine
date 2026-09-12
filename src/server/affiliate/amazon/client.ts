// Amazon Creators API HTTP client — the only code in FORGE that talks to Amazon. OAuth2
// client-credentials token (kept in memory for its lifetime; never logged or persisted) and the
// catalog operations. Official API only: FORGE never requests amazon.* web pages.

import { AppError } from "../../errors";
import { CREDENTIAL_VERSIONS, type AmazonConfig } from "./config";

export const CREATORS_API_BASE = "https://creatorsapi.amazon/catalog/v1";
const TOKEN_SAFETY_MS = 60_000;

/** A failure reported by Amazon. Carries Amazon's error code and HTTP status — never credentials. */
export class AmazonApiError extends AppError {
  constructor(
    message: string,
    public upstream: { status: number; amazonCode: string | null; retryAfterSeconds?: number },
  ) {
    super(message, upstream.status === 429 ? 429 : 502, upstream.status === 429 ? "amazon_throttled" : "amazon_api_error", upstream);
  }
}

type CachedToken = { key: string; value: string; expiresAt: number };
const g = globalThis as unknown as { __forgeAmazonToken?: CachedToken };

export function resetAmazonTokenCache() {
  g.__forgeAmazonToken = undefined;
}

async function fetchToken(cfg: AmazonConfig, key: string): Promise<CachedToken> {
  const v = CREDENTIAL_VERSIONS[cfg.version];
  const init: RequestInit =
    v.flow === "cognito"
      ? {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${cfg.credentialId}:${cfg.credentialSecret}`).toString("base64")}` },
          body: new URLSearchParams({ grant_type: "client_credentials", scope: "creatorsapi/default" }).toString(),
        }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grant_type: "client_credentials", client_id: cfg.credentialId, client_secret: cfg.credentialSecret, scope: "creatorsapi::default" }),
        };
  const res = await fetch(v.tokenUrl, { ...init, signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown; error?: unknown };
  if (!res.ok || typeof json.access_token !== "string") {
    const code = typeof json.error === "string" ? json.error.slice(0, 60) : null;
    throw new AmazonApiError(`Amazon did not issue a Creators API token (HTTP ${res.status}${code ? `, ${code}` : ""}) — check AMAZON_CREATORS_CREDENTIAL_ID, _SECRET and _VERSION`, { status: res.status === 429 ? 429 : res.status, amazonCode: code });
  }
  const seconds = Number(json.expires_in);
  return { key, value: json.access_token, expiresAt: Date.now() + (Number.isFinite(seconds) && seconds > 60 ? seconds : 3600) * 1000 };
}

async function accessToken(cfg: AmazonConfig, forceRefresh: boolean): Promise<string> {
  const key = `${cfg.version}:${cfg.credentialId}`;
  const cached = g.__forgeAmazonToken;
  if (!forceRefresh && cached && cached.key === key && cached.expiresAt - TOKEN_SAFETY_MS > Date.now()) return cached.value;
  g.__forgeAmazonToken = await fetchToken(cfg, key);
  return g.__forgeAmazonToken.value;
}

export type CreatorsOperation = "getItems" | "searchItems";

/** POSTs a catalog operation. Retries once with a fresh token on 401; surfaces throttling with Retry-After. */
export async function creatorsApi<T>(cfg: AmazonConfig, operation: CreatorsOperation, body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken(cfg, attempt > 0);
    const authorization = CREDENTIAL_VERSIONS[cfg.version].flow === "cognito" ? `Bearer ${token}, Version ${cfg.version}` : `Bearer ${token}`;
    const res = await fetch(`${CREATORS_API_BASE}/${operation}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json", "x-marketplace": cfg.marketplace.host },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 && attempt === 0) continue;
    const json = (await res.json().catch(() => ({}))) as { errors?: Array<{ code?: unknown; message?: unknown }> };
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      throw new AmazonApiError("Amazon throttled the request — slow down and retry later", { status: 429, amazonCode: "TooManyRequests", retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined });
    }
    if (!res.ok) {
      const first = Array.isArray(json.errors) ? json.errors[0] : undefined;
      const code = typeof first?.code === "string" ? first.code.slice(0, 80) : null;
      const detail = typeof first?.message === "string" ? `: ${first.message.slice(0, 200)}` : "";
      throw new AmazonApiError(`Amazon Creators API ${operation} failed (HTTP ${res.status}${code ? `, ${code}` : ""})${detail}`, { status: res.status, amazonCode: code });
    }
    return json as T;
  }
}
