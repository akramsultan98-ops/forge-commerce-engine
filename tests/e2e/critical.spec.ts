import { expect, test } from "@playwright/test";

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.describe("storefront", () => {
  test("home page answers the promise and links into products", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Products worth discovering." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Explore Products" })).toBeVisible();
    await expect(page.getByText("fake reviews, ever")).toBeVisible();
    await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: false });
  });

  test("product page has a tracked CTA, structured data and a score breakdown", async ({ page }, info) => {
    await page.goto("/products");
    const first = page.locator('a[href^="/products/"]').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(/\/products\/[a-z0-9-]+/);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.some((s) => s.includes('"@type":"Product"'))).toBe(true);
    const cta = page.locator('a[href^="/r/"]').first();
    if (await cta.count()) expect(await cta.getAttribute("href")).toMatch(/^\/r\/[A-Za-z0-9]+/);
    await expect(page.getByText("Score breakdown").first()).toBeVisible();
    await page.screenshot({ path: `test-results/product-${info.project.name}.png`, fullPage: false });
  });

  test("Arabic switches the document to RTL", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "forge_locale", value: "ar", url: baseURL! }]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("منتجات تستحق الاكتشاف.");
  });

  test("mobile layout never scrolls horizontally", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("command center", () => {
  test.skip(!EMAIL || !PASSWORD, "Set E2E_EMAIL and E2E_PASSWORD for an existing admin to run admin E2E tests");

  test("login → dashboard → product → command", async ({ page }, info) => {
    await page.goto("/admin/login");
    await page.getByLabel("Email").fill(EMAIL!);
    await page.getByLabel("Password").fill(PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
    await expect(page.getByText("Revenue").first()).toBeVisible();
    await expect(page.getByText("Product opportunities")).toBeVisible();
    await page.screenshot({ path: `test-results/dashboard-${info.project.name}.png`, fullPage: false });

    await page.goto("/admin/products");
    await page.locator('a[href^="/admin/products/"][href*="-"]').first().click();
    await expect(page.getByRole("link", { name: "Research" })).toBeVisible();

    await page.goto("/admin/command");
    await page.getByRole("textbox", { name: "Command" }).fill("Which product should I scale?");
    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText(/scale/i).nth(1)).toBeVisible();
  });
});
