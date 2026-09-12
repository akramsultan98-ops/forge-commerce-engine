# Security

## Controls

| Area | Implementation |
|---|---|
| Authentication | Email + password; scrypt (N=2¹⁵, r=8, p=1, per-user salt); constant-time comparison; dummy hash on unknown users (no enumeration by timing) |
| Sessions | 32-byte random tokens in an httpOnly, SameSite=Lax cookie (`Secure` on https); only the SHA-256 is stored; sliding 14-day expiry; revoked on logout/disable |
| Authorization | RBAC (admin / operator / viewer) — one permission table (`src/lib/rbac.ts`) used by UI and enforced in every service (`assertCan`) and API route |
| API keys | `forge_<prefix>_<secret>`, SHA-256 stored, role-scoped, revocable, last-used tracked, shown once |
| CSRF | Server Actions: Next.js origin check. REST mutations with cookies: `proxy.ts` requires a same-origin `Origin` header. Bearer-key calls carry no ambient credentials |
| Content Security Policy | Per-request nonce + `strict-dynamic` for scripts; `frame-ancestors 'none'`; `object-src 'none'`; `form-action 'self' https://*.myshopify.com`; `base-uri 'self'` |
| Headers | HSTS, X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP; `X-Powered-By` removed |
| Input validation | Zod on every action, route and importer; typed enums; length limits; URL scheme allow-lists |
| SQL injection | Drizzle query builder / parameterised `sql` templates only; the few `sql.raw` fragments are compile-time constants from allow-lists |
| XSS | React escaping; no user HTML rendered; the only `dangerouslySetInnerHTML` is JSON-LD, escaped (`<`, `>`, `&`); Shopify HTML is escaped before sending |
| SSRF | Operator-supplied URLs (link checks, feeds) go through `safeFetch`: http(s) only, ports 80/443, no credentials, internal hostnames refused, every resolved IP checked **at connect time** (defeats DNS rebinding), redirects re-validated, size and time limits |
| Open redirects | `/r/{code}` only redirects to stored, validated http(s) destinations; admin `next` param restricted to `/admin` |
| Secrets | Env vars only, validated at boot; production refuses weak `AUTH_SECRET`/`ENCRYPTION_KEY`; third-party credentials encrypted at rest with AES-256-GCM; never serialised to the browser (server modules throw if bundled client-side); secrets redacted from logs |
| Webhooks | Shopify HMAC-SHA256 over the raw body (app secret, or a store-level secret accepted only for `SHOPIFY_SHOP_DOMAIN`), routed to the organisation connected to the sending store; affiliate postback tokens compared in constant time; idempotency tables (a failed delivery frees its slot so the retry is processed) |
| Client IP | Every request is stamped with its real TCP peer (HMAC-signed per process, installed in `instrumentation.ts`). `X-Forwarded-For` is honoured only when that peer is in `TRUSTED_PROXIES` (IPs, CIDR blocks, `loopback` / `private` / `linklocal`), walking right-to-left past trusted hops; client-controlled entries are never used. Empty = forwarding headers ignored |
| Account recovery | `admin:reset-password` CLI (requires shell and database access): new password, generated and shown once by default (or `--password-stdin`); every session revoked; audited without the password; `--enable` re-enables a disabled account |
| Background jobs | Leased jobs: 30 s heartbeat, completion fenced on owner + attempt, only silent jobs recovered; a timeout aborts the handler's signal and fails the job without automatic re-run; late results are discarded |
| OAuth | Shopify: shop-domain allow-list regex, single-use expiring `state`, HMAC verification, server-side code exchange |
| Rate limiting | Login, API, commands, tracking, redirects, newsletter, webhooks (sliding window) |
| Uploads | CSV only: ≤ 5 MB, extension/MIME check, row limit, strict row validation; exports neutralise spreadsheet formula injection. Assets are URL-referenced (https only) |
| Privacy | IPs stored as keyed HMAC; visitor id only after consent; bot traffic flagged; no third-party trackers |
| Audit | Append-only `audit_logs` for auth, settings, products, links, integrations, jobs, commands |
| Least privilege | Container runs as non-root; DB role should not be superuser; API keys default to viewer |
| Demo safety | `DEMO_MODE` hard-blocks email, Telegram, social posts, Shopify writes/sync and paid AI calls at a single choke point |

## Known limitations / next steps

- The rate limiter is in-memory **per instance** — use a shared store (Redis/Postgres) behind a load balancer.
- No 2FA, self-service password-reset email flow or SSO yet — admins create/disable users; locked-out operators recover with `admin:reset-password`.
- Client-IP resolution depends on `TRUSTED_PROXIES` matching the real reverse proxy; verify it once behind the production proxy (spoofed `X-Forwarded-For` must not change the logged IP).
- API keys are organisation-wide with a role; there are no per-endpoint scopes.
- Asset uploads are URL-based; direct file uploads would need object storage + malware scanning.
- `style-src` allows `'unsafe-inline'` (inline style attributes used by charts); scripts are nonce-only.
- Rotate `ENCRYPTION_KEY` only with a re-encryption script (not yet provided).

Report vulnerabilities privately to the repository owner.
