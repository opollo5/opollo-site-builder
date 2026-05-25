import { test, expect } from "@playwright/test";
import { signInAsUatBot, UAT_BASE_URL } from "./helpers/auth";
import { collectConsole, saveFailureReport } from "./helpers/report";

// ---------------------------------------------------------------------------
// P2 — Insights & analytics
// ---------------------------------------------------------------------------

test.describe("P2 — Insights & analytics", () => {
  let consoleMessages: string[];

  test.beforeEach(async ({ page }) => {
    consoleMessages = collectConsole(page);
    await signInAsUatBot(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await saveFailureReport(page, testInfo, { consoleMessages });
  });

  test("/company/social/analytics loads without error", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/analytics`);
    await page.screenshot({ path: "test-results/uat/insights/analytics-loaded.png" });

    await expect(page).toHaveURL(/\/company\/social\/analytics/);
    const errorBoundary = page.locator("text=Something went wrong");
    await expect(errorBoundary).toHaveCount(0);
  });

  test("/company/social/insights loads without error", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/insights`);
    await page.screenshot({ path: "test-results/uat/insights/insights-loaded.png" });

    await expect(page).toHaveURL(/\/company\/social\/insights/);
    const errorBoundary = page.locator("text=Something went wrong");
    await expect(errorBoundary).toHaveCount(0);
  });

  test("7d period selector filters data", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/insights?period=7d`);
    await page.screenshot({ path: "test-results/uat/insights/period-7d.png" });
    await expect(page).toHaveURL(/period=7d/);
    const errorBoundary = page.locator("text=Something went wrong");
    await expect(errorBoundary).toHaveCount(0);
  });

  test("30d period selector filters data", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/insights?period=30d`);
    await page.screenshot({ path: "test-results/uat/insights/period-30d.png" });
    await expect(page).toHaveURL(/period=30d/);
    const errorBoundary = page.locator("text=Something went wrong");
    await expect(errorBoundary).toHaveCount(0);
  });

  test("90d period selector filters data", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/insights?period=90d`);
    await page.screenshot({ path: "test-results/uat/insights/period-90d.png" });
    await expect(page).toHaveURL(/period=90d/);
    const errorBoundary = page.locator("text=Something went wrong");
    await expect(errorBoundary).toHaveCount(0);
  });
});
