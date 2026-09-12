// Server boot: migrations (embedded DB / AUTO_MIGRATE), default org + schedules + sources,
// and the embedded job runner. Idempotent across hot reloads.

import { getDb, getDbDriver } from "./db/client";
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { systemContext } from "./context";
import { logger } from "./logging/logger";
import { ensureDefaultOrganization } from "./services/org";
import { ensureDefaultSchedules } from "./jobs/scheduler";
import { ensureSources } from "./discovery/service";
import { JobRunner } from "./jobs/runner";
import { trustedProxies } from "./security/client-ip";

const g = globalThis as unknown as { __forgeBoot?: Promise<void>; __forgeRunner?: JobRunner };

export function bootServer(opts: { startRunner: boolean }): Promise<void> {
  if (!g.__forgeBoot) {
    g.__forgeBoot = (async () => {
      // Fail fast on a malformed TRUSTED_PROXIES rather than silently trusting nobody (or everybody).
      const proxies = trustedProxies();
      const db = getDb();
      if (getDbDriver() === "pglite" || process.env.AUTO_MIGRATE === "true") await runMigrations();
      const org = await ensureDefaultOrganization(db);
      await ensureDefaultSchedules(db, org.id);
      await ensureSources(systemContext(org.id, db));
      // An embedded database that starts empty on every cold start (a Vercel preview on pglite://memory)
      // can load the labelled demo data. Never on PostgreSQL, never outside DEMO_MODE; skips if present.
      if (env().DEMO_SEED_ON_BOOT && env().DEMO_MODE && getDbDriver() === "pglite") {
        const { seedDemo } = await import("./seed/demo");
        const seeded = await seedDemo(db);
        logger.info("demo data seeded on boot", { skipped: !!seeded.skipped, products: seeded.products, events: seeded.events });
      }
      if (opts.startRunner && env().JOB_RUNNER === "embedded" && !g.__forgeRunner) {
        g.__forgeRunner = new JobRunner(db, { concurrency: env().WORKER_CONCURRENCY });
        g.__forgeRunner.start();
      }
      logger.info("FORGE booted", { driver: getDbDriver(), demoMode: env().DEMO_MODE, jobRunner: env().JOB_RUNNER, trustedProxies: proxies.size });
    })().catch((err) => {
      g.__forgeBoot = undefined;
      logger.error("FORGE boot failed", { err });
      throw err;
    });
  }
  return g.__forgeBoot;
}

/** Pages and routes await this so the embedded DB is migrated before the first query. */
export function ensureBooted(): Promise<void> {
  return bootServer({ startRunner: env().JOB_RUNNER === "embedded" });
}
