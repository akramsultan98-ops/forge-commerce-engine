import path from "node:path";
import fs from "node:fs";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

/**
 * The application database handle.
 *
 * Production uses node-postgres against a real PostgreSQL server. For zero-dependency local
 * development and for tests, `DATABASE_URL=pglite://<dir>` (or `pglite://memory`) runs an embedded
 * PostgreSQL (PGlite, real Postgres compiled to WASM). Both expose the identical Drizzle
 * `PgDatabase` query builder, so the rest of the app is driver-agnostic.
 */
export type Database = NodePgDatabase<typeof schema>;
export type DbDriver = "postgres" | "pglite";

type DbHandle = { db: Database; driver: DbDriver; close: () => Promise<void> };

const globalForDb = globalThis as unknown as { __forgeDb?: DbHandle };

export function parseDatabaseUrl(url: string): { driver: DbDriver; target: string } {
  if (url.startsWith("pglite://")) {
    const target = url.slice("pglite://".length);
    return { driver: "pglite", target: target === "" ? "memory" : target };
  }
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return { driver: "postgres", target: url };
  throw new Error("DATABASE_URL must start with postgres://, postgresql:// or pglite://");
}

export function createDb(url: string): DbHandle {
  const { driver, target } = parseDatabaseUrl(url);
  if (driver === "pglite") {
    let client: PGlite;
    if (target === "memory") {
      client = new PGlite();
    } else {
      const dir = path.resolve(process.cwd(), target);
      fs.mkdirSync(dir, { recursive: true });
      client = new PGlite(dir);
    }
    const db = drizzlePglite({ client, schema }) as unknown as Database;
    return { db, driver, close: () => client.close() };
  }
  const pool = new Pool({
    connectionString: target,
    max: env().DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  const db = drizzlePg({ client: pool, schema });
  return { db, driver, close: () => pool.end() };
}

function handle(): DbHandle {
  if (!globalForDb.__forgeDb) globalForDb.__forgeDb = createDb(env().DATABASE_URL);
  return globalForDb.__forgeDb;
}

/** Lazily-initialised singleton database (survives Next.js dev hot reloads). */
export function getDb(): Database {
  return handle().db;
}

export function getDbDriver(): DbDriver {
  return handle().driver;
}

export async function closeDb() {
  const h = globalForDb.__forgeDb;
  globalForDb.__forgeDb = undefined;
  if (h) await h.close();
}

/** Tests inject an isolated in-memory database. */
export function setDbForTesting(h: DbHandle | undefined) {
  globalForDb.__forgeDb = h;
}

export { schema };
