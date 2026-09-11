// DEMO seed — every record is flagged is_demo / DEMO provenance and labelled in the UI.
// Refuses to run unless DEMO_MODE=true so demo data never lands in a production database.

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { affiliateLinks, campaigns, clickEvents, content, contentMetrics, conversionEvents, commissions, landingPages, orders, productTests, productDecisions, products, suppliers, experiments, type Product } from "../db/schema";
import { systemContext } from "../context";
import { isDemoMode } from "../env";
import { ensureDefaultOrganization } from "../services/org";
import { upsertCategory } from "../services/catalog";
import { createNetwork, createLink } from "../services/affiliate";
import { createProduct } from "../services/products";
import { scoreAllProducts } from "../services/scoring";
import { createContentFromConcepts } from "../services/content";
import { syncProductMetrics } from "../services/analytics";
import { refreshRecommendations } from "../services/recommendations";
import { generateArticleIdeas, listArticles, setArticleStatus, writeArticle } from "../services/articles";
import { buildBrief } from "../ai/brief";
import { templateConcepts } from "../ai/templates";
import { landingPageAgent, reportingAgent, researchAgent } from "../agents/agents";
import { runAgent } from "../agents/runtime";
import { hashIp } from "../security/crypto";
import { logger } from "../logging/logger";
import type { ContentStatus, ProductStatus } from "@/lib/constants";

type SeedProduct = {
  title: string;
  category: string;
  model: "AFFILIATE" | "DROPSHIPPING";
  price: number;
  cost?: number;
  ship?: number;
  days?: [number, number];
  commission?: number;
  status: ProductStatus;
  problem: string;
  audience: string;
  description: string;
  highlights: string[];
  tags: string[];
  f: { trend: number; competition: number; content: number; impulse: number; problem: number; novelty: number; saturation?: number };
  rating?: [number, number];
  trendKeyword?: string;
  traffic?: { views: number; ctr: number; conv: number; days: number; growth?: number };
};

const CATEGORIES = [
  { name: "Home & Kitchen", icon: "CookingPot", description: "Small fixes for everyday home friction." },
  { name: "Desk & Tech", icon: "Laptop", description: "Cleaner, calmer workspaces." },
  { name: "Car & Travel", icon: "Car", description: "Less clutter on the move." },
  { name: "Pets", icon: "PawPrint", description: "Practical upgrades for pet owners." },
  { name: "Outdoor & Fitness", icon: "Tent", description: "Light, packable, useful." },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  { title: "Silicone Stretch Lids (6-Pack)", category: "Home & Kitchen", model: "DROPSHIPPING", price: 14.99, cost: 2.8, ship: 2.1, days: [7, 12], status: "TESTING", problem: "leftover bowls with no lid that fits", audience: "home cooks who hate food waste", description: "Stretchy, food-safe silicone lids that seal bowls, cans and half-cut fruit of different sizes.", highlights: ["Six sizes stretch to fit most bowls and cans", "Dishwasher-safe food-grade silicone", "Replaces single-use cling film"], tags: ["kitchen", "zero waste", "storage"], f: { trend: 64, competition: 62, content: 82, impulse: 88, problem: 80, novelty: 55, saturation: 55 }, rating: [4.4, 1800], traffic: { views: 90, ctr: 0.07, conv: 0.014, days: 9, growth: 0.03 } },
  { title: "Motion-Sensor Closet Light (2-Pack)", category: "Home & Kitchen", model: "DROPSHIPPING", price: 22.99, cost: 5.9, ship: 2.4, days: [6, 11], status: "RESEARCHING", problem: "fumbling around in a dark closet", audience: "renters and small-apartment dwellers", description: "Rechargeable LED bars that switch on when you open the door and off when you leave.", highlights: ["Motion sensor with auto-off", "USB-C rechargeable", "Magnetic strip mount — no drilling"], tags: ["lighting", "renter friendly"], f: { trend: 58, competition: 60, content: 78, impulse: 76, problem: 74, novelty: 48 } },
  { title: "Electric Fabric Shaver", category: "Home & Kitchen", model: "AFFILIATE", price: 19.99, commission: 9, status: "WINNER", problem: "pilled sweaters that make clothes look old", audience: "anyone with knitwear, sofas or wool coats", description: "A rechargeable fabric shaver that removes pills and fuzz from clothes and upholstery in a few passes.", highlights: ["Three height settings to protect delicate knits", "Removable lint chamber", "Works on sweaters, sofas and coats"], tags: ["laundry", "clothing care", "before and after"], f: { trend: 71, competition: 70, content: 92, impulse: 84, problem: 82, novelty: 50, saturation: 66 }, rating: [4.5, 5200], trendKeyword: "Lint roller", traffic: { views: 180, ctr: 0.11, conv: 0.022, days: 30, growth: 0.02 } },
  { title: "Over-Sink Roll-Up Dish Rack", category: "Home & Kitchen", model: "DROPSHIPPING", price: 26.99, cost: 7.2, ship: 3.1, days: [8, 14], status: "DISCOVERED", problem: "no counter space to dry dishes", audience: "small-kitchen apartment owners", description: "A roll-up rack that sits over the sink to dry dishes and rinse produce, then rolls away.", highlights: ["Rolls up for storage", "Heat-resistant silicone-coated steel", "Fits most standard sinks"], tags: ["kitchen", "small space"], f: { trend: 52, competition: 55, content: 70, impulse: 62, problem: 76, novelty: 45 } },
  { title: "Magnetic Cable Organizer (6 Clips)", category: "Desk & Tech", model: "DROPSHIPPING", price: 12.99, cost: 2.1, ship: 1.8, days: [6, 10], status: "TESTING", problem: "charging cables falling behind the desk", audience: "people who work from a desk", description: "Adhesive-base clips with magnetic holders that keep charging cables right where you left them.", highlights: ["Magnetic holders — cables click in and stay", "Strong adhesive base for desks and nightstands", "Six clips for phone, laptop and headphone cables"], tags: ["desk setup", "cable management"], f: { trend: 66, competition: 58, content: 80, impulse: 90, problem: 78, novelty: 62 }, trendKeyword: "Cable management", traffic: { views: 40, ctr: 0.06, conv: 0.012, days: 9, growth: 0.06 } },
  { title: "Under-Desk Cable Management Tray", category: "Desk & Tech", model: "AFFILIATE", price: 34.99, commission: 8, status: "DISCOVERED", problem: "a tangle of cables under your desk", audience: "home-office workers", description: "A steel tray that mounts under the desk and hides power strips and cable runs.", highlights: ["Holds a full power strip", "Clamp-on or screw mount", "Open-top design for airflow"], tags: ["desk setup", "home office"], f: { trend: 60, competition: 48, content: 68, impulse: 50, problem: 72, novelty: 40 } },
  { title: "Mini Thermal Label Printer", category: "Desk & Tech", model: "AFFILIATE", price: 39.99, commission: 10, status: "APPROVED", problem: "unlabelled jars, cables and folders", audience: "organisers, small-business packers and students", description: "A pocket-size Bluetooth label printer that prints ink-free labels from your phone.", highlights: ["Ink-free thermal printing", "Prints from a phone app over Bluetooth", "Works with multiple label widths"], tags: ["organisation", "small business"], f: { trend: 74, competition: 55, content: 86, impulse: 60, problem: 70, novelty: 72, saturation: 58 }, trendKeyword: "Label printer" },
  { title: "Foldable Aluminum Laptop Stand", category: "Desk & Tech", model: "DROPSHIPPING", price: 29.99, cost: 8.5, ship: 3.4, days: [7, 12], status: "DISCOVERED", problem: "hunching over a laptop screen all day", audience: "remote workers and students", description: "A foldable aluminium stand that lifts the laptop screen closer to eye level.", highlights: ["Six height positions", "Folds flat into a sleeve", "Aluminium body with silicone grips"], tags: ["desk setup", "remote work"], f: { trend: 55, competition: 78, content: 64, impulse: 58, problem: 70, novelty: 30, saturation: 70 } },
  { title: "Car Seat Gap Filler (2-Pack)", category: "Car & Travel", model: "DROPSHIPPING", price: 16.99, cost: 3.2, ship: 2.3, days: [7, 12], status: "TESTING", problem: "phones and keys falling between the car seats", audience: "drivers and commuters", description: "Soft fillers that plug the gap between the seat and the centre console.", highlights: ["Fits most car seats", "Built-in slot for a phone or cards", "Wipe-clean surface"], tags: ["car", "organisation"], f: { trend: 62, competition: 64, content: 84, impulse: 86, problem: 86, novelty: 58 }, traffic: { views: 70, ctr: 0.09, conv: 0.004, days: 9 } },
  { title: "Magnetic Phone Car Mount", category: "Car & Travel", model: "AFFILIATE", price: 21.99, commission: 7, status: "KILLED", problem: "a phone sliding around the dashboard", audience: "drivers who use phone navigation", description: "A vent-clip magnetic mount for phones.", highlights: ["Vent clip mount", "Includes metal plates"], tags: ["car", "phone accessories"], f: { trend: 50, competition: 85, content: 60, impulse: 70, problem: 60, novelty: 20, saturation: 78 }, traffic: { views: 25, ctr: 0.015, conv: 0.002, days: 12 } },
  { title: "Compression Packing Cubes (Set of 4)", category: "Car & Travel", model: "AFFILIATE", price: 28.99, commission: 10, status: "RESEARCHING", problem: "an overstuffed suitcase that won't close", audience: "frequent travellers and carry-on packers", description: "Zip-compression packing cubes that sort and shrink clothes in a suitcase.", highlights: ["Double zip compresses contents", "Four sizes", "Mesh panels to see what's inside"], tags: ["travel", "packing"], f: { trend: 68, competition: 60, content: 76, impulse: 62, problem: 78, novelty: 45 } },
  { title: "Cordless Handheld Car Vacuum", category: "Car & Travel", model: "DROPSHIPPING", price: 44.99, cost: 13.8, ship: 4.6, days: [8, 14], status: "DISCOVERED", problem: "crumbs and sand stuck in car mats", audience: "parents and dog owners with cars", description: "A compact rechargeable vacuum with a crevice nozzle for car interiors.", highlights: ["Crevice and brush nozzles", "Washable filter", "USB-C rechargeable"], tags: ["car", "cleaning"], f: { trend: 57, competition: 74, content: 80, impulse: 48, problem: 76, novelty: 35, saturation: 65 } },
  { title: "Reusable Pet Hair Remover Roller", category: "Pets", model: "AFFILIATE", price: 18.99, commission: 12, status: "WINNER", problem: "pet hair all over the sofa", audience: "dog and cat owners", description: "A reusable roller that lifts pet hair off sofas, beds and car seats — empty the chamber and reuse.", highlights: ["No sticky sheets to replace", "Self-cleaning base chamber", "Works on sofas, beds and car seats"], tags: ["pets", "cleaning", "before and after"], f: { trend: 70, competition: 68, content: 90, impulse: 84, problem: 88, novelty: 52, saturation: 60 }, rating: [4.6, 9100], trendKeyword: "Lint roller", traffic: { views: 150, ctr: 0.12, conv: 0.026, days: 30, growth: 0.015 } },
  { title: "Lick Mat for Dogs (2-Pack)", category: "Pets", model: "DROPSHIPPING", price: 15.99, cost: 2.6, ship: 2.2, days: [7, 12], status: "DISCOVERED", problem: "a dog who won't sit still at bath time", audience: "dog owners", description: "Textured silicone mats that stick to the wall and keep dogs busy with a spread of treat paste.", highlights: ["Suction cups for tiles and tubs", "Dishwasher-safe silicone", "Two textures"], tags: ["pets", "grooming"], f: { trend: 63, competition: 58, content: 82, impulse: 80, problem: 72, novelty: 50 } },
  { title: "Collapsible Travel Dog Bowl", category: "Pets", model: "AFFILIATE", price: 11.99, commission: 8, status: "DISCOVERED", problem: "no water for your dog on long walks", audience: "dog walkers and hikers", description: "A silicone bowl that folds flat and clips to a leash or bag.", highlights: ["Folds flat", "Carabiner clip included"], tags: ["pets", "travel"], f: { trend: 48, competition: 70, content: 58, impulse: 78, problem: 66, novelty: 30 } },
  { title: "Automatic Cat Laser Toy", category: "Pets", model: "DROPSHIPPING", price: 27.99, cost: 7.9, ship: 3.1, days: [8, 13], status: "DISCOVERED", problem: "a bored indoor cat at 3am", audience: "indoor cat owners", description: "A rotating toy that projects a moving laser pattern with an auto-off timer.", highlights: ["Random movement patterns", "15-minute auto-off"], tags: ["pets", "cat toys"], f: { trend: 59, competition: 57, content: 88, impulse: 66, problem: 64, novelty: 60 } },
  { title: "Bladeless Portable Neck Fan", category: "Outdoor & Fitness", model: "AFFILIATE", price: 24.99, commission: 9, status: "PAUSED", problem: "overheating on hot commutes", audience: "commuters and festival-goers", description: "A wearable bladeless fan that sits around the neck.", highlights: ["Three speed settings", "Bladeless — no hair snagging"], tags: ["summer", "commute"], f: { trend: 45, competition: 72, content: 74, impulse: 72, problem: 70, novelty: 40 } },
  { title: "Resistance Band Set with Door Anchor", category: "Outdoor & Fitness", model: "AFFILIATE", price: 29.99, commission: 11, status: "DISCOVERED", problem: "no space or budget for gym equipment", audience: "people training at home", description: "Five stackable bands with handles, ankle straps and a door anchor.", highlights: ["Five resistance levels, stackable", "Door anchor and ankle straps included"], tags: ["home workout"], f: { trend: 52, competition: 82, content: 70, impulse: 56, problem: 68, novelty: 25, saturation: 72 }, trendKeyword: "Resistance band" },
  { title: "Collapsible Silicone Water Bottle", category: "Outdoor & Fitness", model: "DROPSHIPPING", price: 17.99, cost: 3.4, ship: 2.5, days: [7, 12], status: "DISCOVERED", problem: "bulky bottles taking up bag space", audience: "hikers, travellers and gym-goers", description: "A leak-proof bottle that collapses to a flat disc when empty.", highlights: ["Collapses to about a third of its height", "Leak-proof cap"], tags: ["travel", "outdoor"], f: { trend: 54, competition: 60, content: 72, impulse: 74, problem: 64, novelty: 55 }, trendKeyword: "Water bottle" },
  { title: "Collapsible Solar Camping Lantern", category: "Outdoor & Fitness", model: "AFFILIATE", price: 23.99, commission: 8, status: "DISCOVERED", problem: "no light at the campsite once your phone dies", audience: "campers and emergency-kit builders", description: "A lantern that collapses flat and recharges by solar panel or USB.", highlights: ["Solar panel plus USB charging", "Collapses flat for packing"], tags: ["camping", "outdoor"], f: { trend: 50, competition: 55, content: 66, impulse: 60, problem: 66, novelty: 58 }, trendKeyword: "Lantern" },
];

// Deterministic PRNG so demo analytics are stable between runs.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weighted<T>(rand: () => number, items: Array<[T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export interface SeedSummary {
  skipped?: boolean;
  categories: number;
  suppliers: number;
  networks: number;
  products: number;
  content: number;
  campaigns: number;
  landingPages: number;
  events: number;
  conversions: number;
}

export async function seedDemo(db: Database, opts: { events?: boolean; days?: number } = {}): Promise<SeedSummary> {
  if (!isDemoMode()) throw new Error("Refusing to seed demo data: set DEMO_MODE=true (demo data must never land in a production database).");
  const org = await ensureDefaultOrganization(db);
  const ctx = systemContext(org.id, db);
  const existing = await db.select({ id: products.id }).from(products).where(and(eq(products.organizationId, org.id), eq(products.isDemo, true))).limit(1);
  if (existing.length) return { skipped: true, categories: 0, suppliers: 0, networks: 0, products: 0, content: 0, campaigns: 0, landingPages: 0, events: 0, conversions: 0 };
  const days = opts.days ?? 30;

  const cats = new Map<string, string>();
  for (const c of CATEGORIES) cats.set(c.name, (await upsertCategory(ctx, { name: c.name, description: c.description, icon: c.icon }, true)).id);

  const supplierRows = await db
    .insert(suppliers)
    .values([
      { organizationId: org.id, name: "CJdropshipping — demo account", adapter: "CJ", website: "https://cjdropshipping.com", shippingDaysMin: 7, shippingDaysMax: 12, countries: ["US", "GB", "CA", "AU", "DE"], isDemo: true, notes: "DEMO supplier" },
      { organizationId: org.id, name: "HomeGoods Factory Store (AliExpress) — demo", adapter: "ALIEXPRESS", website: "https://www.aliexpress.com", shippingDaysMin: 8, shippingDaysMax: 14, countries: ["US", "GB", "CA", "AU", "AE", "SA"], isDemo: true, notes: "DEMO supplier" },
      { organizationId: org.id, name: "US Warehouse Partner — demo", adapter: "SHOPIFY_SUPPLIER", shippingDaysMin: 3, shippingDaysMax: 6, countries: ["US", "CA"], isDemo: true, notes: "DEMO supplier" },
    ])
    .returning();

  const nets = [
    await createNetwork(ctx, { name: "Impact (demo)", type: "IMPACT", website: "https://impact.com", defaultCookieDays: 30 }, true),
    await createNetwork(ctx, { name: "Awin (demo)", type: "AWIN", website: "https://www.awin.com", defaultCookieDays: 30 }, true),
    await createNetwork(ctx, { name: "Amazon Associates (demo)", type: "AMAZON_ASSOCIATES", website: "https://affiliate-program.amazon.com", defaultCookieDays: 1 }, true),
  ];

  const created: Array<{ product: Product; seed: SeedProduct }> = [];
  for (const [i, s] of SEED_PRODUCTS.entries()) {
    const p = await createProduct(
      ctx,
      {
        title: s.title,
        description: s.description,
        categoryId: cats.get(s.category),
        supplierId: s.model === "DROPSHIPPING" ? supplierRows[i % 2].id : null,
        supplierUrl: s.model === "DROPSHIPPING" ? `https://example.com/forge-demo/supplier/${i + 1}` : null,
        productUrl: `https://example.com/forge-demo/merchant/${i + 1}`,
        currency: "USD",
        sellingPrice: s.price,
        cost: s.cost ?? null,
        shippingCost: s.ship ?? null,
        shippingDaysMin: s.days?.[0] ?? null,
        shippingDaysMax: s.days?.[1] ?? null,
        commissionPercentage: s.commission ?? null,
        countriesAvailable: ["US", "GB", "CA", "AU", "AE"],
        rating: s.rating?.[0] ?? null,
        reviewCount: s.rating?.[1] ?? null,
        trendScore: s.f.trend,
        competitionScore: s.f.competition,
        contentScore: s.f.content,
        impulseScore: s.f.impulse,
        problemScore: s.f.problem,
        noveltyScore: s.f.novelty,
        saturationScore: s.f.saturation ?? null,
        trendKeyword: s.trendKeyword ?? null,
        businessModel: s.model,
        targetAudience: s.audience,
        problemSolved: s.problem,
        highlights: s.highlights,
        tags: s.tags,
      },
      { provenance: "DEMO", isDemo: true, source: "DEMO", sourceProductId: `demo-seed-${String(i + 1).padStart(2, "0")}`, sourceLabel: "FORGE demo seed", skipAudit: true },
    );
    if (s.model === "AFFILIATE") {
      const link = await createLink(ctx, { productId: p.id, networkId: nets[i % 3].id, url: `https://example.com/forge-demo/merchant/${i + 1}?ref=forge`, merchant: "Demo Merchant", commissionRate: s.commission ?? null, cookieDays: 30, isPrimary: true }, { isDemo: true });
      await db.update(affiliateLinks).set({ status: s.status === "KILLED" ? "PAUSED" : "ACTIVE", lastCheckedAt: new Date() }).where(eq(affiliateLinks.id, link.id));
    } else {
      // Owned-inventory products: the tracked link points at the (demo) store checkout.
      const link = await createLink(ctx, { productId: p.id, url: `https://example.com/forge-demo/store/${i + 1}`, merchant: "FORGE demo store", isPrimary: true }, { isDemo: true });
      await db.update(affiliateLinks).set({ status: "ACTIVE", lastCheckedAt: new Date() }).where(eq(affiliateLinks.id, link.id));
    }
    created.push({ product: p, seed: s });
  }
  await scoreAllProducts(ctx);

  // Lifecycle states + tests.
  const now = Date.now();
  for (const { product, seed } of created) {
    await db.update(products).set({ status: seed.status, statusChangedAt: new Date(now - (seed.traffic?.days ?? 2) * 86400_000) }).where(eq(products.id, product.id));
    if (seed.status === "TESTING") {
      await db.insert(productTests).values({ organizationId: org.id, productId: product.id, status: "RUNNING", startedAt: new Date(now - 9 * 86400_000), plannedDays: 14 });
    }
    if (seed.status === "WINNER" || seed.status === "KILLED") {
      const winner = seed.status === "WINNER";
      await db.insert(productTests).values({
        organizationId: org.id,
        productId: product.id,
        status: "COMPLETED",
        startedAt: new Date(now - (winner ? 30 : 16) * 86400_000),
        endedAt: new Date(now - (winner ? 16 : 3) * 86400_000),
        plannedDays: 14,
        verdict: winner ? "WINNER" : "FAILURE",
        decision: winner ? "SCALE" : "KILL",
        reasons: winner ? ["Click-through above 8%", "Conversion above 1.5%", "Positive organic earnings"] : ["Click-through ≤ 2.5%", "Conversion ≤ 0.4%", "Crowded market with heavy ad saturation"],
      });
      await db.insert(productDecisions).values({ organizationId: org.id, productId: product.id, decision: winner ? "SCALE" : "KILL", verdict: winner ? "WINNER" : "FAILURE", reasons: winner ? ["Winner — scale content output"] : ["Low demand, low engagement, poor conversion"], applied: true });
    }
  }

  // Research, landing pages (template engine in DEMO_MODE), publish the live ones.
  let pages = 0;
  for (const { product, seed } of created.filter((c) => ["TESTING", "WINNER", "APPROVED", "RESEARCHING", "KILLED"].includes(c.seed.status))) {
    await runAgent(ctx, researchAgent, { productId: product.id }, { productId: product.id });
    if (seed.status === "RESEARCHING") continue;
    const { output } = await runAgent(ctx, landingPageAgent, { productId: product.id }, { productId: product.id });
    pages++;
    if (["TESTING", "WINNER"].includes(seed.status)) await db.update(landingPages).set({ status: "PUBLISHED", publishedAt: new Date(now - (seed.traffic?.days ?? 5) * 86400_000) }).where(eq(landingPages.id, output.landingPageId));
    // Research moved some to RESEARCHING — restore the intended lifecycle state.
    await db.update(products).set({ status: seed.status }).where(eq(products.id, product.id));
  }

  // 5 campaigns × 2 content items = 10 content items.
  const plan: Array<{ title: string; platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "PINTEREST"; type: "TIKTOK_VIDEO" | "INSTAGRAM_REEL" | "YOUTUBE_SHORT" | "PINTEREST_PIN"; statuses: ContentStatus[]; spend: number }> = [
    { title: "Electric Fabric Shaver", platform: "TIKTOK", type: "TIKTOK_VIDEO", statuses: ["WINNER", "PUBLISHED"], spend: 0 },
    { title: "Reusable Pet Hair Remover Roller", platform: "INSTAGRAM", type: "INSTAGRAM_REEL", statuses: ["WINNER", "ANALYZING"], spend: 45 },
    { title: "Silicone Stretch Lids (6-Pack)", platform: "TIKTOK", type: "TIKTOK_VIDEO", statuses: ["PUBLISHED", "SCHEDULED"], spend: 30 },
    { title: "Car Seat Gap Filler (2-Pack)", platform: "YOUTUBE", type: "YOUTUBE_SHORT", statuses: ["PUBLISHED", "SCRIPTED"], spend: 0 },
    { title: "Magnetic Cable Organizer (6 Clips)", platform: "PINTEREST", type: "PINTEREST_PIN", statuses: ["ASSET_READY", "IDEA"], spend: 0 },
  ];
  const contentByProduct = new Map<string, Array<{ id: string; utm: string; status: ContentStatus }>>();
  for (const item of plan) {
    const entry = created.find((c) => c.seed.title === item.title)!;
    const brief = buildBrief(entry.product);
    const concepts = templateConcepts(brief, { platform: item.platform, contentType: item.type, count: 2 });
    const rows = await createContentFromConcepts(ctx, entry.product, concepts, { platform: item.platform, contentType: item.type, method: "TEMPLATE", model: "forge-template-v1" });
    for (const [j, r] of rows.entries()) {
      const status = item.statuses[j];
      const published = ["PUBLISHED", "WINNER", "ANALYZING"].includes(status);
      await db
        .update(content)
        .set({ status, publishedAt: published ? new Date(now - (8 - j * 3) * 86400_000) : null, scheduledAt: status === "SCHEDULED" ? new Date(now + 2 * 86400_000) : published ? new Date(now - (8 - j * 3) * 86400_000) : null })
        .where(eq(content.id, r.id));
      const list = contentByProduct.get(entry.product.id) ?? [];
      list.push({ id: r.id, utm: r.utmContent ?? "", status });
      contentByProduct.set(entry.product.id, list);
    }
    await db.update(campaigns).set({ status: "ACTIVE", spend: item.spend, startAt: new Date(now - 10 * 86400_000), budget: item.spend ? item.spend * 3 : null }).where(and(eq(campaigns.productId, entry.product.id), eq(campaigns.platform, item.platform)));
  }
  const campaignCount = (await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.organizationId, org.id))).length;

  // A running headline experiment on the stretch-lids page.
  const lids = created.find((c) => c.seed.title.startsWith("Silicone Stretch Lids"))!;
  const [lidsPage] = await db.select().from(landingPages).where(eq(landingPages.productId, lids.product.id)).limit(1);
  let experimentId: string | null = null;
  if (lidsPage) {
    const [exp] = await db
      .insert(experiments)
      .values({ organizationId: org.id, productId: lids.product.id, landingPageId: lidsPage.id, name: "Headline: problem-first vs outcome-first", type: "HEADLINE", status: "RUNNING", hypothesis: "An outcome-first headline lifts click-through.", primaryMetric: "PRODUCT_CTR", startedAt: new Date(now - 9 * 86400_000), variants: [{ key: "control", name: "Problem-first", weight: 50, changes: {} }, { key: "b", name: "Outcome-first", weight: 50, changes: { headline: "Every bowl, sealed. No cling film." } }] })
      .returning({ id: experiments.id });
    experimentId = exp.id;
  }

  // Demo traffic, clicks, conversions, orders and platform metrics.
  let events = 0;
  let conversions = 0;
  if (opts.events !== false) {
    const rand = mulberry32(20260912);
    const sources: Array<[string, number]> = [["tiktok", 50], ["instagram", 22], ["youtube", 10], ["pinterest", 8], ["google", 5], ["direct", 5]];
    const countries: Array<[string, number]> = [["US", 58], ["GB", 14], ["CA", 10], ["AU", 8], ["AE", 5], ["DE", 5]];
    const eventRows: Array<typeof clickEvents.$inferInsert> = [];
    const convRows: Array<typeof conversionEvents.$inferInsert> = [];
    const orderRows: Array<typeof orders.$inferInsert> = [];
    for (const { product, seed } of created) {
      if (!seed.traffic) continue;
      const t = seed.traffic;
      const [link] = await db.select().from(affiliateLinks).where(eq(affiliateLinks.productId, product.id)).limit(1);
      const [page] = await db.select({ id: landingPages.id }).from(landingPages).where(eq(landingPages.productId, product.id)).limit(1);
      const items = contentByProduct.get(product.id) ?? [];
      const activeDays = Math.min(t.days, days);
      const startOffset = seed.status === "KILLED" ? 16 : activeDays;
      for (let d = startOffset; d > startOffset - activeDays; d--) {
        const dayStart = now - d * 86400_000;
        const growth = 1 + (t.growth ?? 0) * (startOffset - d);
        const views = Math.max(0, Math.round(t.views * growth * (0.75 + rand() * 0.5)));
        for (let v = 0; v < views; v++) {
          const at = new Date(dayStart + rand() * 86400_000);
          if (at.getTime() > now) continue;
          const source = weighted(rand, sources);
          const social = !["google", "direct"].includes(source);
          const utmContent = social && items.length && rand() < 0.7 ? items[Math.floor(rand() * items.length)].utm : null;
          const visitor = `demo-${Math.floor(rand() * 1e9).toString(36)}`;
          const variant = experimentId && product.id === lids.product.id ? (rand() < 0.5 ? "control" : "b") : null;
          const country = weighted(rand, countries);
          const base = {
            organizationId: org.id,
            productId: product.id,
            landingPageId: page?.id ?? null,
            visitorId: visitor,
            utmSource: source === "direct" ? null : source,
            utmMedium: social ? "organic" : source === "google" ? "organic_search" : null,
            utmCampaign: social ? product.slug : null,
            utmContent,
            referrer: source === "direct" ? null : `https://www.${source}.com/`,
            country,
            device: rand() < 0.78 ? "mobile" : "desktop",
            ipHash: hashIp(`198.51.100.${Math.floor(rand() * 250)}`),
            userAgent: "Mozilla/5.0 (demo seed)",
            isBot: false,
            isDemo: true,
            experimentId: variant ? experimentId : null,
            variant,
          };
          eventRows.push({ ...base, eventType: "PAGE_VIEW", path: page ? `/lp/${product.slug}` : `/products/${product.slug}`, createdAt: at });
          const ctr = variant === "b" ? t.ctr * 1.25 : t.ctr;
          if (rand() < ctr) {
            const clickAt = new Date(at.getTime() + 20_000);
            if (seed.model === "AFFILIATE") eventRows.push({ ...base, eventType: "AFFILIATE_CLICK", affiliateLinkId: link?.id ?? null, path: `/r/${link?.code ?? "demo"}`, createdAt: clickAt });
            else {
              eventRows.push({ ...base, eventType: "PRODUCT_CLICK", path: `/products/${product.slug}`, createdAt: clickAt });
              if (rand() < 0.45) eventRows.push({ ...base, eventType: "CHECKOUT", path: `/products/${product.slug}`, createdAt: new Date(clickAt.getTime() + 30_000) });
            }
            if (rand() < t.conv / ctr) {
              const occurredAt = new Date(clickAt.getTime() + 3600_000 * rand());
              conversions++;
              if (seed.model === "AFFILIATE") {
                convRows.push({ organizationId: org.id, type: "PURCHASE", productId: product.id, affiliateLinkId: link?.id ?? null, source: "demo", externalId: `demo-conv-${conversions}`, revenue: seed.price, commission: Math.round(seed.price * (seed.commission ?? 8)) / 100, currency: "USD", utmSource: base.utmSource, utmCampaign: base.utmCampaign, utmContent, country, provenance: "DEMO", isDemo: true, occurredAt });
              } else {
                orderRows.push({ organizationId: org.id, productId: product.id, source: "DEMO", externalOrderId: `demo-order-${conversions}`, status: "PAID", quantity: 1, revenue: seed.price, cost: seed.cost ?? 0, shippingCost: seed.ship ?? 0, currency: "USD", country, utmSource: base.utmSource, utmCampaign: base.utmCampaign, utmContent, isDemo: true, occurredAt });
              }
            }
          }
        }
      }
    }
    for (let i = 0; i < eventRows.length; i += 500) await db.insert(clickEvents).values(eventRows.slice(i, i + 500));
    for (let i = 0; i < convRows.length; i += 500) {
      const inserted = await db.insert(conversionEvents).values(convRows.slice(i, i + 500)).returning({ id: conversionEvents.id, productId: conversionEvents.productId, commission: conversionEvents.commission, occurredAt: conversionEvents.occurredAt, linkId: conversionEvents.affiliateLinkId });
      await db.insert(commissions).values(inserted.map((c) => ({ organizationId: org.id, productId: c.productId, affiliateLinkId: c.linkId, conversionEventId: c.id, amount: c.commission, currency: "USD", status: "APPROVED" as const, isDemo: true, occurredAt: c.occurredAt })));
    }
    for (let i = 0; i < orderRows.length; i += 500) await db.insert(orders).values(orderRows.slice(i, i + 500));
    events = eventRows.length;

    // Platform metrics (normally synced from social APIs or entered manually).
    const published = await db.select().from(content).where(and(eq(content.organizationId, org.id), inArray(content.status, ["PUBLISHED", "WINNER", "ANALYZING"])));
    const metricRows: Array<typeof contentMetrics.$inferInsert> = [];
    for (const c of published) {
      const winner = c.status === "WINNER";
      for (let d = 7; d >= 0; d--) {
        const views = Math.round((winner ? 6000 : 1400) * (0.6 + rand() * 0.8) * Math.max(0.3, 1 - d * 0.05));
        metricRows.push({
          contentId: c.id,
          date: new Date(now - d * 86400_000).toISOString().slice(0, 10),
          views,
          reach: Math.round(views * 0.82),
          likes: Math.round(views * (winner ? 0.075 : 0.04)),
          comments: Math.round(views * 0.006),
          shares: Math.round(views * (winner ? 0.012 : 0.004)),
          saves: Math.round(views * 0.009),
          profileVisits: Math.round(views * 0.02),
          clicks: Math.round(views * (winner ? 0.018 : 0.007)),
          provenance: "DEMO",
          source: "demo seed",
        });
      }
    }
    for (let i = 0; i < metricRows.length; i += 500) await db.insert(contentMetrics).values(metricRows.slice(i, i + 500));
    await syncProductMetrics(ctx, days + 2);
  }

  await refreshRecommendations(ctx);
  await runAgent(ctx, reportingAgent, { type: "TOP5_WEEKLY" });
  await generateArticleIdeas(ctx);
  const ideas = await listArticles(ctx, { status: "IDEA" });
  for (const [i, a] of ideas.slice(0, 2).entries()) {
    await writeArticle(ctx, a.id);
    if (i === 0) await setArticleStatus(ctx, a.id, "PUBLISHED");
  }
  const contentCount = (await db.select({ id: content.id }).from(content).where(eq(content.organizationId, org.id))).length;
  logger.info("demo seed complete", { products: created.length, events, conversions });
  return { categories: CATEGORIES.length, suppliers: supplierRows.length, networks: nets.length, products: created.length, content: contentCount, campaigns: campaignCount, landingPages: pages, events, conversions };
}
