import { describe, expect, it } from "vitest";
import { extractProductRef, parseCommand } from "@/server/command/parser";

describe("command parser (section 59 examples)", () => {
  it.each([
    ["Find me 10 products under $30 with strong TikTok potential.", "FIND_PRODUCTS"],
    ["Show me the best 5 products this week.", "TOP_PRODUCTS"],
    ["Why did Product X fail?", "EXPLAIN_PRODUCT"],
    ["Create a landing page for Product X.", "CREATE_LANDING_PAGE"],
    ["Generate 20 TikTok ideas for Product X.", "GENERATE_CONTENT"],
    ["Which product should I scale?", "WHICH_TO_SCALE"],
    ["Which product should I kill?", "WHICH_TO_KILL"],
    ["Show me products with high traffic but low conversion.", "HIGH_TRAFFIC_LOW_CONVERSION"],
    ["Find products with rising demand and low competition.", "RISING_DEMAND_LOW_COMPETITION"],
    ["Launch a test for Mini Thermal Label Printer", "LAUNCH_TEST"],
    ["help", "HELP"],
    ["purple monkey dishwasher", "UNKNOWN"],
  ])("%s → %s", (input, intent) => {
    expect(parseCommand(input).intent).toBe(intent);
  });

  it("extracts limit, max price, platform and traits", () => {
    const p = parseCommand("Find me 10 products under $30 with strong TikTok potential.");
    expect(p).toMatchObject({ limit: 10, maxPrice: 30, platform: "TIKTOK" });
    expect(p.traits).toContain("content");
    const g = parseCommand("Generate 20 TikTok ideas for Electric Fabric Shaver.");
    expect(g).toMatchObject({ limit: 20, platform: "TIKTOK", productQuery: "Electric Fabric Shaver" });
  });

  it("extracts product references", () => {
    expect(extractProductRef('Why did "Car Seat Gap Filler" fail?')).toBe("Car Seat Gap Filler");
    expect(extractProductRef("Why did Magnetic Phone Car Mount fail?")).toBe("Magnetic Phone Car Mount");
    expect(extractProductRef("Create a landing page for the Silicone Stretch Lids.")).toBe("Silicone Stretch Lids");
  });
});
