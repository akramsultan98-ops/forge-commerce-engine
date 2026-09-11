/* Standalone background worker (JOB_RUNNER=external). Run as many replicas as you like —
 * jobs are claimed with FOR UPDATE SKIP LOCKED. Requires a real PostgreSQL DATABASE_URL. */
try {
  process.loadEnvFile(".env");
} catch {
  /* rely on the real environment */
}

async function main() {
  const { getDb, getDbDriver, closeDb } = await import("../src/server/db/client");
  const { runMigrations } = await import("../src/server/db/migrate");
  const { ensureDefaultOrganization } = await import("../src/server/services/org");
  const { ensureDefaultSchedules } = await import("../src/server/jobs/scheduler");
  const { JobRunner } = await import("../src/server/jobs/runner");
  const { env } = await import("../src/server/env");
  if (getDbDriver() === "pglite") {
    console.error("The standalone worker needs PostgreSQL. With the embedded PGlite database use JOB_RUNNER=embedded (the web process runs jobs).");
    process.exit(1);
  }
  const db = getDb();
  if (process.env.AUTO_MIGRATE === "true") await runMigrations();
  const org = await ensureDefaultOrganization(db);
  await ensureDefaultSchedules(db, org.id);
  const runner = new JobRunner(db, { concurrency: env().WORKER_CONCURRENCY });
  runner.start();
  const shutdown = async (signal: string) => {
    console.log(`${signal} received — draining worker`);
    await runner.stop();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
