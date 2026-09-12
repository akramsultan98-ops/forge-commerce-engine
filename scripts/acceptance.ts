/* FORGE final acceptance test (section 63) — runs the real workflow over HTTP against a running app.
 *
 *   ACCEPTANCE_EMAIL=… ACCEPTANCE_PASSWORD=… npm run acceptance
 *   optional: ACCEPTANCE_BASE_URL (default http://localhost:3000), ACCEPTANCE_VIEWER_EMAIL / _PASSWORD
 *
 * Steps 18–20 (mobile UI, tests, production build) are separate commands: npm run test:e2e / npm test / npm run build.
 */
export {};

try {
  process.loadEnvFile(".env");
} catch {
  /* optional */
}

const BASE = (process.env.ACCEPTANCE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 FORGE-acceptance";
const results: Array<{ n: number; name: string; ok: boolean; detail: string }> = [];
let cookie = "";

async function http(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = { "User-Agent": UA, ...(init.headers as Record<string, string>) };
  if (cookie) headers.Cookie = cookie;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(init.json);
  }
  if (init.method && init.method !== "GET") headers.Origin = BASE;
  return fetch(`${BASE}${path}`, { ...init, headers, redirect: init.redirect ?? "manual" });
}

async function data<T = Record<string, unknown>>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { message: string } };
  if (!res.ok) throw new Error(`${res.status} ${body.error?.message ?? res.statusText}`);
  return body.data as T;
}

async function waitJob(id: number, timeoutMs = 240_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const j = await data<{ status: string; lastError: string | null; result: unknown }>(await http(`/api/v1/jobs/${id}`));
    if (j.status === "succeeded") return j.result as Record<string, unknown>;
    if (j.status === "failed" || j.status === "cancelled") throw new Error(`job ${id} ${j.status}: ${j.lastError}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`job ${id} timed out`);
}

async function step(n: number, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? "";
    results.push({ n, name, ok: true, detail });
    console.log(`✓ ${String(n).padStart(2)}. ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ n, name, ok: false, detail });
    console.log(`✗ ${String(n).padStart(2)}. ${name} — ${detail}`);
  }
}

async function main() {
  const email = process.env.ACCEPTANCE_EMAIL;
  const password = process.env.ACCEPTANCE_PASSWORD;
  if (!email || !password) throw new Error("Set ACCEPTANCE_EMAIL and ACCEPTANCE_PASSWORD (create one with npm run admin:create).");
  const stamp = Date.now().toString(36);
  let productId = "";
  let slug = "";
  let linkCode = "";

  await step(1, "Start application (health check)", async () => {
    const h = (await (await http("/api/health")).json()) as { status: string; dbDriver: string; demoMode: boolean };
    if (h.status !== "ok") throw new Error(JSON.stringify(h));
    return `db=${h.dbDriver} demoMode=${h.demoMode}`;
  });
  await step(2, "Admin user exists", async () => "created beforehand via `npm run admin:create` (verified by login)");
  await step(3, "Login", async () => {
    const res = await http("/api/auth/login", { method: "POST", json: { email, password } });
    const setCookie = res.headers.get("set-cookie") ?? "";
    const u = await data<{ role: string }>(res);
    cookie = setCookie.split(";")[0];
    if (!cookie.startsWith("forge_session=")) throw new Error("no session cookie");
    return `role=${u.role}`;
  });
  await step(4, "Add / import products", async () => {
    const csv = `title,price,cost,shipping_days,url,category,countries\nAcceptance Desk Hook ${stamp},16.99,3.10,9,https://example.com/store/hook-${stamp},Desk & Tech,US|GB\n`;
    const imp = await data<{ created: number }>(await http("/api/v1/products/import?model=DROPSHIPPING", { method: "POST", body: csv, headers: { "Content-Type": "text/csv" } }));
    const created = await data<{ product: { id: string; slug: string } }>(
      await http("/api/v1/products", {
        method: "POST",
        json: { title: `Acceptance Lint Roller ${stamp}`, businessModel: "AFFILIATE", sellingPrice: 18.99, commissionPercentage: 12, problemSolved: "pet hair on the sofa", targetAudience: "pet owners", contentScore: 88, problemScore: 85, impulseScore: 80, trendScore: 70, competitionScore: 50, noveltyScore: 55, highlights: ["No sticky sheets"], affiliateUrl: "https://example.com/merchant/lint-roller" },
      }),
    );
    productId = created.product.id;
    slug = created.product.slug;
    return `CSV created ${imp.created}; API created ${slug}`;
  });
  await step(5, "Run product scoring", async () => {
    const s = await data<{ overall: number; reasons: string[] }>(await http(`/api/v1/products/${productId}/actions`, { method: "POST", json: { action: "score" } }));
    return `score ${s.overall} · ${s.reasons.slice(0, 2).join("; ")}`;
  });
  await step(6, "Run product research", async () => {
    const j = await data<{ jobId: number }>(await http(`/api/v1/products/${productId}/actions`, { method: "POST", json: { action: "research" } }));
    const r = (await waitJob(j.jobId)) as { research?: { verdict: string; thesis: string } };
    return `${r.research?.verdict} — ${r.research?.thesis.slice(0, 70)}…`;
  });
  await step(7, "Generate Top 5 report", async () => {
    const j = await data<{ jobId: number }>(await http("/api/v1/reports?type=TOP5_DAILY", { method: "POST" }));
    await waitJob(j.jobId);
    const rep = await data<{ content: { entries: unknown[] } }>(await http("/api/v1/reports?type=TOP5_DAILY"));
    return `${rep.content.entries.length} entries`;
  });
  await step(8, "Open product page", async () => {
    await data(await http(`/api/v1/products/${productId}`, { method: "PATCH", json: { status: "APPROVED" } }));
    const res = await http(`/products/${slug}`);
    const html = await res.text();
    if (res.status !== 200 || !html.includes("Acceptance Lint Roller")) throw new Error(`status ${res.status}`);
    return `/products/${slug} (200)`;
  });
  await step(9, "Generate landing page", async () => {
    const j = await data<{ jobId: number }>(await http(`/api/v1/products/${productId}/actions`, { method: "POST", json: { action: "landing_page" } }));
    const r = await waitJob(j.jobId);
    return `/lp/${r.slug} (${r.template}, ${r.method})`;
  });
  await step(10, "Generate content", async () => {
    const j = await data<{ jobId: number }>(await http(`/api/v1/products/${productId}/actions`, { method: "POST", json: { action: "content", platform: "PINTEREST", contentType: "PINTEREST_PIN", count: 3 } }));
    const r = await waitJob(j.jobId);
    return `${r.created} pins`;
  });
  await step(11, "Generate TikTok scripts", async () => {
    const j = await data<{ jobId: number }>(await http(`/api/v1/products/${productId}/actions`, { method: "POST", json: { action: "content", batch: "launch" } }));
    await waitJob(j.jobId);
    const list = await data<{ items: Array<{ platform: string; script: Array<{ label: string; from: number; to: number }> | null; trackingUrl: string }> }>(await http(`/api/v1/content?productId=${productId}&platform=TIKTOK`));
    const ok = list.items.filter((i) => i.script?.[0]?.label === "HOOK" && i.script[0].to === 3);
    if (ok.length < 10) throw new Error(`only ${ok.length} scripts`);
    return `${ok.length} scripts with HOOK 0–3s; tracked ${list.items[0].trackingUrl}`;
  });
  await step(12, "Generate affiliate link", async () => {
    const l = await data<{ code: string; trackedUrl: string }>(await http("/api/v1/affiliate-links", { method: "POST", json: { productId, url: "https://example.com/merchant/lint-roller?ref=acc", commissionRate: 12, isPrimary: true } }));
    linkCode = l.code;
    return l.trackedUrl;
  });
  await step(13, "Track click", async () => {
    const res = await http(`/r/${linkCode}?utm_source=tiktok&utm_medium=organic&utm_campaign=${slug}&utm_content=video_001`);
    if (res.status !== 302) throw new Error(`status ${res.status}`);
    return `302 → ${res.headers.get("location")}`;
  });
  await step(14, "Display analytics", async () => {
    const s = await data<{ kpis: { affiliateClicks: number; pageViews: number; revenue: number } }>(await http("/api/v1/analytics/summary?days=1"));
    if (s.kpis.affiliateClicks < 1) throw new Error("click not counted");
    return `affiliate clicks ${s.kpis.affiliateClicks}, page views ${s.kpis.pageViews}`;
  });
  await step(15, "Run automation", async () => {
    const j = await data<{ jobId: number }>(await http("/api/v1/jobs", { method: "POST", json: { type: "analytics_sync" } }));
    const r = await waitJob(j.jobId);
    return `analytics_sync → ${JSON.stringify(r).slice(0, 80)}`;
  });
  await step(16, "Generate recommendation", async () => {
    const j = await data<{ jobId: number }>(await http("/api/v1/jobs", { method: "POST", json: { type: "recommendations_refresh" } }));
    await waitJob(j.jobId);
    const recs = await data<Array<{ title: string }>>(await http("/api/v1/recommendations"));
    const cmd = await data<{ intent: string; reply: string }>(await http("/api/v1/command", { method: "POST", json: { input: "Which product should I scale?" } }));
    return `${recs.length} open recommendations; command → ${cmd.intent}`;
  });
  await step(17, "Verify permissions", async () => {
    const saved = cookie;
    cookie = "";
    const anon = await http("/api/v1/products");
    cookie = saved;
    const csrf = await fetch(`${BASE}/api/v1/products`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
    if (anon.status !== 401) throw new Error(`anonymous got ${anon.status}`);
    if (csrf.status !== 403) throw new Error(`cross-origin got ${csrf.status}`);
    let viewer = "viewer check skipped (set ACCEPTANCE_VIEWER_EMAIL/_PASSWORD)";
    if (process.env.ACCEPTANCE_VIEWER_EMAIL && process.env.ACCEPTANCE_VIEWER_PASSWORD) {
      const res = await http("/api/auth/login", { method: "POST", json: { email: process.env.ACCEPTANCE_VIEWER_EMAIL, password: process.env.ACCEPTANCE_VIEWER_PASSWORD } });
      const vc = (res.headers.get("set-cookie") ?? "").split(";")[0];
      const w = await fetch(`${BASE}/api/v1/products`, { method: "POST", headers: { Cookie: vc, "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ title: "nope" }) });
      if (w.status !== 403) throw new Error(`viewer write got ${w.status}`);
      viewer = "viewer write → 403";
    }
    return `anonymous → 401, cross-origin → 403, ${viewer}`;
  });
  console.log("\n18–20: run `npm run test:e2e` (mobile + desktop UI), `npm test`, `npm run build`.");
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} acceptance steps passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
