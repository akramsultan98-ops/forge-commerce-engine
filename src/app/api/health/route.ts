import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, getDbDriver } from "@/server/db/client";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";
const started = Date.now();

/** Liveness + database health. Public, minimal, no secrets. */
export async function GET() {
  const t = Date.now();
  let db: "ok" | "error" = "ok";
  let queue: { queued: number; running: number; failed24h: number } | null = null;
  try {
    const res = await getDb().execute(sql`
      select count(*) filter (where status = 'queued')::int as queued,
             count(*) filter (where status = 'running')::int as running,
             count(*) filter (where status = 'failed' and finished_at > now() - interval '1 day')::int as failed24h
      from jobs`);
    const row = res.rows[0] as { queued: number; running: number; failed24h: number };
    queue = { queued: Number(row.queued), running: Number(row.running), failed24h: Number(row.failed24h) };
  } catch {
    db = "error";
  }
  const body = { status: db === "ok" ? "ok" : "degraded", db, dbDriver: getDbDriver(), dbLatencyMs: Date.now() - t, queue, jobRunner: env().JOB_RUNNER, demoMode: env().DEMO_MODE, uptimeSeconds: Math.round((Date.now() - started) / 1000), version: "0.1.0" };
  return NextResponse.json(body, { status: db === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
