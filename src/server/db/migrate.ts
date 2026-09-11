import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { getDb, getDbDriver, type Database } from "./client";
import { logger } from "../logging/logger";

const MIGRATION_LOCK_ID = 7_140_331; // arbitrary constant for pg_advisory_lock

export function migrationsFolder() {
  return process.env.FORGE_MIGRATIONS_DIR ?? path.join(process.cwd(), "drizzle");
}

/**
 * Applies pending SQL migrations from ./drizzle. Guarded by a Postgres advisory lock so the app
 * and worker can both call it on boot without racing.
 */
export async function runMigrations(db: Database = getDb(), driver = getDbDriver()) {
  const folder = migrationsFolder();
  const started = Date.now();
  if (driver === "pglite") {
    await migratePglite(db as unknown as PgliteDatabase<Record<string, unknown>>, { migrationsFolder: folder });
  } else {
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`);
    try {
      await migratePg(db, { migrationsFolder: folder });
    } finally {
      await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`);
    }
  }
  logger.info("database migrations applied", { driver, ms: Date.now() - started });
}
