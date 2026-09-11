import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "forge_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Endpoints called by third parties / beacons — they authenticate by signature or are public by design.
const CSRF_EXEMPT = [/^\/api\/webhooks\//, /^\/api\/track$/, /^\/api\/integrations\/shopify\/callback$/, /^\/api\/health$/];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CSRF defence for cookie-authenticated API mutations: require a same-origin Origin header.
  // (Server Actions have Next.js' own origin check; bearer-token API calls carry no ambient cookie.)
  if (pathname.startsWith("/api/") && !SAFE_METHODS.has(req.method) && !CSRF_EXEMPT.some((r) => r.test(pathname))) {
    const bearer = req.headers.get("authorization")?.startsWith("Bearer ");
    if (!bearer) {
      const origin = req.headers.get("origin");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      let ok = false;
      try {
        ok = !!origin && !!host && new URL(origin).host === host;
      } catch {
        ok = false;
      }
      if (!ok) return NextResponse.json({ error: { code: "csrf_blocked", message: "Cross-origin request blocked" } }, { status: 403 });
    }
  }

  // Cheap admin gate (cookie presence). The session is fully validated server-side on every render.
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login") && !pathname.startsWith("/admin/setup") && !req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Strict, nonce-based Content Security Policy (Next.js applies the nonce to its own scripts).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self' https:",
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.myshopify.com",
    "object-src 'none'",
    dev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-pathname", pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
