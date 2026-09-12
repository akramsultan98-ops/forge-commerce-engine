/* FORGE CLI — `tsx scripts/cli.ts <command> [--flags]`
 *   migrate                      apply database migrations
 *   seed [--no-events] [--days=30]   seed labelled DEMO data (requires DEMO_MODE=true)
 *   admin:create --email=… --name=… [--password=…] [--role=admin|operator|viewer]
 *   admin:reset-password --email=… [--password-stdin | --password=…] [--enable]
 *                                account recovery: new password (generated if omitted), all sessions revoked
 *   first-run                    run the first-run discovery workflow now (Top 5 + launch kits)
 *   jobs:drain                   execute every queued job, then exit
 *   reset --yes                  DROP all data (refused in production)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export {};

try {
  process.loadEnvFile(".env");
} catch {
  /* no .env — rely on the real environment */
}

function flags(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  const { getDb, closeDb, getDbDriver } = await import("../src/server/db/client");
  const { runMigrations } = await import("../src/server/db/migrate");
  const { ensureDefaultOrganization } = await import("../src/server/services/org");
  const { ensureDefaultSchedules } = await import("../src/server/jobs/scheduler");
  const db = getDb();
  try {
    switch (command) {
      case "migrate": {
        await runMigrations();
        const org = await ensureDefaultOrganization(db);
        await ensureDefaultSchedules(db, org.id);
        console.log(`✓ migrations applied (${getDbDriver()})`);
        break;
      }
      case "seed": {
        await runMigrations();
        const { seedDemo } = await import("../src/server/seed/demo");
        const summary = await seedDemo(db, { events: !f["no-events"], days: f.days ? Number(f.days) : 30 });
        console.log(summary.skipped ? "Demo data already present — skipped." : `✓ demo data seeded: ${JSON.stringify(summary)}`);
        break;
      }
      case "admin:create": {
        await runMigrations();
        const { createUser } = await import("../src/server/auth/core");
        const email = String(f.email ?? process.env.ADMIN_EMAIL ?? "");
        const name = String(f.name ?? process.env.ADMIN_NAME ?? "Admin");
        const generated = !f.password && !process.env.ADMIN_PASSWORD;
        const password = String(f.password ?? process.env.ADMIN_PASSWORD ?? crypto.randomBytes(12).toString("base64url"));
        const role = (String(f.role ?? "admin") as "admin" | "operator" | "viewer");
        if (!email) throw new Error("--email is required");
        const org = await ensureDefaultOrganization(db);
        const user = await createUser(db, { organizationId: org.id, email, name, password, role });
        console.log(`✓ ${role} created: ${user.email}`);
        if (generated) console.log(`  generated password (shown once): ${password}`);
        break;
      }
      case "admin:reset-password": {
        // Account recovery for operators with shell access to the server / container.
        await runMigrations();
        const { resetUserPassword } = await import("../src/server/auth/core");
        const { audit } = await import("../src/server/audit");
        const { systemContext } = await import("../src/server/context");
        const email = String(f.email ?? process.env.ADMIN_EMAIL ?? "");
        if (!email || email === "true") throw new Error("--email is required");
        let password: string;
        let generated = false;
        if (f["password-stdin"]) {
          let input = "";
          for await (const chunk of process.stdin) input += chunk;
          password = input.replace(/\r?\n$/, "");
        } else if (typeof f.password === "string") {
          password = f.password;
          console.warn("  warning: --password is visible in shell history and process lists; prefer --password-stdin or a generated password");
        } else if (process.env.ADMIN_PASSWORD) {
          password = process.env.ADMIN_PASSWORD;
        } else {
          password = crypto.randomBytes(18).toString("base64url");
          generated = true;
        }
        const user = await resetUserPassword(db, { email, password, enable: f.enable === true });
        await audit({ ...systemContext(user.organizationId, db), ip: null }, "auth.password_reset", { type: "user", id: user.id }, { via: "cli", sessionsRevoked: user.sessionsRevoked, reenabled: f.enable === true });
        console.log(`✓ password reset for ${user.email} (${user.role}); ${user.sessionsRevoked} session(s) revoked${f.enable === true ? "; account enabled" : ""}`);
        if (generated) console.log(`  new password (shown once — store it in a password manager): ${password}`);
        if (user.disabled) console.log("  note: this account is disabled — re-run with --enable to allow sign-in");
        break;
      }
      case "first-run": {
        await runMigrations();
        const org = await ensureDefaultOrganization(db);
        const { enqueueJob } = await import("../src/server/jobs/queue");
        const { drainQueue } = await import("../src/server/jobs/runner");
        await enqueueJob(db, { type: "first_run", orgId: org.id, trigger: "MANUAL", dedupeKey: "first-run" });
        const results = await drainQueue(db, { maxJobs: 50 });
        for (const r of results) console.log(`${r.ok ? "✓" : "✗"} job #${r.id} ${r.type}${r.error ? ` — ${r.error}` : ""}`);
        break;
      }
      case "jobs:drain": {
        const { drainQueue } = await import("../src/server/jobs/runner");
        const results = await drainQueue(db, { maxJobs: Number(f.max ?? 200) });
        console.log(`drained ${results.length} jobs (${results.filter((r) => !r.ok).length} failed)`);
        break;
      }
      case "reset": {
        if (process.env.NODE_ENV === "production") throw new Error("reset is disabled in production");
        if (!f.yes) throw new Error("reset deletes ALL data — re-run with --yes");
        if (getDbDriver() === "pglite") {
          await closeDb();
          const dir = path.resolve(process.cwd(), (process.env.DATABASE_URL ?? "").replace("pglite://", ""));
          if (dir.includes(".data")) fs.rmSync(dir, { recursive: true, force: true });
          console.log(`✓ removed ${dir}`);
          return;
        }
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`drop schema if exists public cascade`);
        await db.execute(sql`drop schema if exists drizzle cascade`);
        await db.execute(sql`create schema public`);
        await runMigrations();
        console.log("✓ database reset and migrated");
        break;
      }
      default:
        console.log("Commands: migrate | seed | admin:create | admin:reset-password | first-run | jobs:drain | reset --yes");
        process.exitCode = command ? 1 : 0;
    }
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
