import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { affiliateNetworks, campaigns, categories, content, products, suppliers } from "@/server/db/schema";
import { seedDemo } from "@/server/seed/demo";
import { assertOutboundAllowed } from "@/server/demo";
import { sendEmail } from "@/server/integrations/email";
import { sendTelegram } from "@/server/integrations/telegram";
import { publishContent } from "@/server/integrations/social";
import { publishProductToShopify } from "@/server/integrations/shopify";
import { DemoModeBlockedError, IntegrationNotConfiguredError } from "@/server/errors";
import { freshDb } from "../support/db";

let t: Awaited<ReturnType<typeof freshDb>>;
beforeAll(async () => {
  t = await freshDb();
}, 120_000);
afterAll(async () => t.close());

describe("demo seed (section 46)", () => {
  it("seeds the required, clearly-labelled demo data", async () => {
    const s = await seedDemo(t.db, { events: false });
    expect(s).toMatchObject({ products: 20, categories: 5, suppliers: 3, networks: 3, campaigns: 5 });
    expect(s.content).toBeGreaterThanOrEqual(10);
    const all = await t.db.select().from(products);
    expect(all).toHaveLength(20);
    expect(all.every((p) => p.isDemo && Object.values(p.fieldProvenance).every((f) => f.p === "DEMO"))).toBe(true);
    expect((await t.db.select().from(categories)).every((c) => c.isDemo)).toBe(true);
    expect((await t.db.select().from(suppliers)).every((c) => c.isDemo)).toBe(true);
    expect((await t.db.select().from(affiliateNetworks)).every((n) => n.isDemo)).toBe(true);
    expect((await t.db.select().from(campaigns)).every((c) => c.isDemo)).toBe(true);
    expect((await t.db.select().from(content).where(eq(content.isDemo, false))).length).toBe(0);
    expect((await seedDemo(t.db, { events: false })).skipped).toBe(true);
  }, 120_000);
});

describe("DEMO_MODE guards (section 47)", () => {
  it("blocks every outbound side effect", async () => {
    expect(() => assertOutboundAllowed("anything")).toThrow(DemoModeBlockedError);
    await expect(sendEmail({ subject: "s", text: "t" })).rejects.toBeInstanceOf(DemoModeBlockedError);
    await expect(sendTelegram("hi")).rejects.toBeInstanceOf(DemoModeBlockedError);
    await expect(publishProductToShopify({ ...t.ctx }, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(DemoModeBlockedError);
  });

  it("refuses to fake social publishing without credentials", async () => {
    const [item] = await t.db.select().from(content).limit(1);
    await expect(publishContent(t.ctx, item.id)).rejects.toBeInstanceOf(IntegrationNotConfiguredError);
  });
});
