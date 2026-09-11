// Trend scoring from a daily interest series (e.g. Wikimedia pageviews). Pure + testable.

import { clamp, round } from "@/lib/utils";
import { piecewise } from "./scoring";

export interface TrendSummary {
  recentAvg: number;
  priorAvg: number;
  growthPct: number;
  score: number;
  points: number;
}

/** recent = last 28 days vs prior = the days before that. Score blends growth (70%) and volume (30%). */
export function trendFromSeries(daily: number[]): TrendSummary | null {
  if (daily.length < 35) return null;
  const recent = daily.slice(-28);
  const prior = daily.slice(0, -28);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  const growthPct = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : recentAvg > 0 ? 100 : 0;
  const growthScore = piecewise(growthPct, [[-50, 10], [-10, 35], [0, 45], [15, 65], [40, 85], [100, 100]]);
  const volumeScore = piecewise(Math.log10(Math.max(1, recentAvg)), [[0, 5], [1, 20], [2, 45], [3, 70], [4, 90]]);
  return { recentAvg: round(recentAvg, 1), priorAvg: round(priorAvg, 1), growthPct: round(growthPct, 1), score: round(clamp(0.7 * growthScore + 0.3 * volumeScore)), points: daily.length };
}
