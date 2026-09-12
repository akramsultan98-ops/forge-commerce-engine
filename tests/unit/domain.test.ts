import { describe, expect, it } from "vitest";
import { describeCron, isValidCron, nextCronDate, parseCron } from "@/domain/cron";
import { mapProductCsv, parseCsv, toCsv } from "@/domain/csv";
import { appendSubId, buildUtmUrl, contentUtmId, isSafeRedirectUrl, normalizeUtmValue, parseUtm } from "@/domain/utm";
import { faqJsonLd, jsonLd, metaDescription, productJsonLd, seoTitle } from "@/domain/seo";
import { assignVariant, compareProportions, normalCdf } from "@/domain/stats";
import { trendFromSeries } from "@/domain/trends";
import { convert, retailRound, suggestPrice } from "@/domain/money";

describe("cron", () => {
  it("computes next fire times in UTC", () => {
    const from = new Date("2026-09-12T04:10:00Z");
    expect(nextCronDate("0 5 * * *", from).toISOString()).toBe("2026-09-12T05:00:00.000Z");
    expect(nextCronDate("*/15 * * * *", from).toISOString()).toBe("2026-09-12T04:15:00.000Z");
    expect(nextCronDate("0 8 * * 1", from).toISOString()).toBe("2026-09-14T08:00:00.000Z"); // next Monday
    expect(nextCronDate("30 4 1 1 *", from).toISOString()).toBe("2027-01-01T04:30:00.000Z");
  });
  it("treats restricted day-of-month and day-of-week as OR", () => {
    expect(nextCronDate("0 0 15 * 1", new Date("2026-09-12T00:00:00Z")).toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });
  it("validates and describes expressions", () => {
    expect(isValidCron("0 */6 * * *")).toBe(true);
    expect(isValidCron("61 * * * *")).toBe(false);
    expect(isValidCron("* * *")).toBe(false);
    expect(parseCron("0 9 * * MON-FRI").dow.values.size).toBe(5);
    expect(describeCron("0 8 * * 1")).toBe("Weekly on Monday at 08:00 UTC");
    expect(describeCron("0 5 * * *")).toBe("Daily at 05:00 UTC");
  });
});

describe("csv", () => {
  it("parses quotes, escaped quotes and embedded newlines", () => {
    const rows = parseCsv('a,b\n"x, y","he said ""hi""\nthere"\n');
    expect(rows).toEqual([["a", "b"], ["x, y", 'he said "hi"\nthere']]);
  });
  it("maps aliased columns and reports bad rows", () => {
    const r = mapProductCsv("name,price,cost,commission,url,countries\nLabel Printer,$39.99,,10,https://m.example/p,US|CA\nX,abc,,,,\n");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ title: "Label Printer", sellingPrice: 39.99, commissionPercentage: 10, countriesAvailable: ["US", "CA"] });
    expect(r.errors[0].line).toBe(3);
  });
  it("requires a title column", () => {
    expect(mapProductCsv("price\n10").errors[0].message).toContain("title");
  });
  it("neutralises spreadsheet formula injection on export", () => {
    expect(toCsv([{ a: "=HYPERLINK(1)", b: "plain" }])).toBe("a,b\n'=HYPERLINK(1),plain");
  });
});

describe("utm & redirects", () => {
  it("adds UTMs while preserving existing params and hash", () => {
    const u = new URL(buildUtmUrl("https://shop.example/p?id=4#top", { source: "TikTok", medium: "organic", campaign: "Cable Clips!", content: "video_001" }));
    expect(u.searchParams.get("id")).toBe("4");
    expect(u.searchParams.get("utm_source")).toBe("tiktok");
    expect(u.searchParams.get("utm_campaign")).toBe("cable_clips");
    expect(u.hash).toBe("#top");
  });
  it("parses and normalises", () => {
    expect(parseUtm(new URLSearchParams("utm_source=ig&x=1"))).toEqual({ utm_source: "ig" });
    expect(normalizeUtmValue("  Crème Brûlée ")).toBe("creme_brulee");
    expect(contentUtmId("TIKTOK_VIDEO", 1)).toBe("video_001");
  });
  it("appends network sub-ids and rejects unsafe redirect targets", () => {
    expect(appendSubId("https://net.example/c?m=1", "subId1", "abc")).toBe("https://net.example/c?m=1&subId1=abc");
    expect(isSafeRedirectUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectUrl("data:text/html,x")).toBe(false);
    expect(isSafeRedirectUrl("https://merchant.example")).toBe(true);
  });
});

describe("seo", () => {
  it("escapes JSON-LD so it cannot break out of the script tag", () => {
    expect(jsonLd({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
  it("never adds a rating that wasn't provided", () => {
    const ld = productJsonLd({ name: "X", description: "d", url: "https://f.example/p/x", currency: "USD", price: 10, available: true });
    expect(ld).not.toHaveProperty("aggregateRating");
    expect(ld.offers).toMatchObject({ price: "10.00", priceCurrency: "USD" });
  });
  it("keeps titles and descriptions within SERP limits", () => {
    expect(seoTitle("A".repeat(200)).length).toBeLessThanOrEqual(60);
    expect(metaDescription("word ".repeat(100)).length).toBeLessThanOrEqual(155);
    expect(faqJsonLd([{ q: "Q", a: "A" }]).mainEntity).toHaveLength(1);
  });
});

describe("stats, trends, money", () => {
  it("detects a significant lift and not a noisy one", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
    expect(compareProportions(50, 1000, 90, 1000).significant).toBe(true);
    expect(compareProportions(5, 100, 6, 100).significant).toBe(false);
  });
  it("buckets visitors deterministically by weight", () => {
    const v = [{ key: "a", weight: 50 }, { key: "b", weight: 50 }];
    expect(assignVariant(1234, v)).toBe(assignVariant(1234, v));
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10000; i++) counts[assignVariant(i * 7919, v) as "a" | "b"]++;
    expect(Math.abs(counts.a - counts.b)).toBeLessThan(800);
  });
  it("scores interest growth", () => {
    const flat = trendFromSeries(Array(90).fill(100))!;
    const rising = trendFromSeries([...Array(62).fill(100), ...Array(28).fill(200)])!;
    expect(rising.growthPct).toBe(100);
    expect(rising.score).toBeGreaterThan(flat.score);
    expect(trendFromSeries([1, 2, 3])).toBeNull();
  });
  it("converts and prices", () => {
    expect(convert(100, "USD", "SAR", { USD: 1, SAR: 3.75 })).toBe(375);
    expect(convert(375, "SAR", "USD", { USD: 1, SAR: 3.75 })).toBe(100);
    expect(retailRound(23.4)).toBe(23.99);
    expect(suggestPrice(5, 2)).toBe(19.99);
  });
});
