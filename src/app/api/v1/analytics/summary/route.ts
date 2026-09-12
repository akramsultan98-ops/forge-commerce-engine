import { apiRoute } from "@/server/auth/api";
import { breakdown, kpis, leaderboard, rangeForDays } from "@/server/services/analytics";

export const dynamic = "force-dynamic";

/** GET /api/v1/analytics/summary?days=30 — KPIs, top platforms/countries and the product leaderboard. */
export const GET = apiRoute({ permission: "analytics:read" }, async (req, ctx) => {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days") ?? 30) || 30));
  const range = rangeForDays(days);
  const [k, platforms, countries, board] = await Promise.all([kpis(ctx, range), breakdown(ctx, range, "platform", 10), breakdown(ctx, range, "country", 10), leaderboard(ctx, range, 25)]);
  return { range: { from: range.from, to: range.to, days }, currency: "USD", kpis: k, platforms, countries, leaderboard: board };
});
