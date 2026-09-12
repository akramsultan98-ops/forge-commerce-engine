import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq } from "drizzle-orm";
import { products } from "@/server/db/schema";
import { bootServer } from "@/server/boot";
import { resetEnvCache } from "@/server/env";
import { freshDb } from "../support/db";

const g = globalThis as unknown as { __forgeBoot?: Promise<void> };
let t: Awaited<ReturnType<typeof freshDb>>;

async function boot(vars: Record<string, string>) {
  Object.assign(process.env, vars);
  resetEnvCache();
  g.__forgeBoot = undefined; // simulate a fresh process (cold start)
  await bootServer({ startRunner: false });
}
const productCount = async () => Number((await t.db.select({ n: count() }).from(products))[0].n);

beforeAll(async () => {
  t = await freshDb();
});
afterAll(async () => {
  Object.assign(process.env, { DEMO_MODE: "true", DEMO_SEED_ON_BOOT: "false" });
  resetEnvCache();
  await t.close();
});

describe("DEMO_SEED_ON_BOOT", () => {
  it("does nothing unless explicitly enabled", async () => {
    await boot({ DEMO_MODE: "true", DEMO_SEED_ON_BOOT: "false" });
    expect(await productCount()).toBe(0);
  });

  it("never seeds outside DEMO_MODE", async () => {
    await boot({ DEMO_MODE: "false", DEMO_SEED_ON_BOOT: "true" });
    expect(await productCount()).toBe(0);
  });

  it("loads the labelled demo data into an empty embedded database", { timeout: 120_000 }, async () => {
    await boot({ DEMO_MODE: "true", DEMO_SEED_ON_BOOT: "true" });
    const total = await productCount();
    expect(total).toBeGreaterThan(0);
    const [real] = await t.db.select({ n: count() }).from(products).where(eq(products.isDemo, false));
    expect(Number(real.n)).toBe(0); // everything seeded is flagged as demo
  });

  it("is idempotent across cold starts", { timeout: 120_000 }, async () => {
    const before = await productCount();
    await boot({ DEMO_MODE: "true", DEMO_SEED_ON_BOOT: "true" });
    expect(await productCount()).toBe(before);
  });
});
