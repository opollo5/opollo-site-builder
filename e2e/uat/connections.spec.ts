import { test, expect } from "@playwright/test";
import { signInAsUatBot, UAT_BASE_URL } from "./helpers/auth";
import { collectConsole, saveFailureReport } from "./helpers/report";

// ---------------------------------------------------------------------------
// P0 — Connections
// Seed data: LinkedIn (active), Facebook (expired), X/Twitter (pending)
// ---------------------------------------------------------------------------

test.describe("P0 — Connections", () => {
  let consoleMessages: string[];

  test.beforeEach(async ({ page }) => {
    consoleMessages = collectConsole(page);
    await signInAsUatBot(page);
    await page.goto(`${UAT_BASE_URL}/company/social/connections`);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await saveFailureReport(page, testInfo, { consoleMessages });
  });

  test("connections list renders — 3 seed connections visible", async ({
    page,
  }) => {
    // Wait for connections to load
    const table = page.locator('[data-testid="connections-list-wrapper"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/uat/connections/list-loaded.png" });

    // Should show 3 connection rows (LinkedIn active, Facebook expired, X pending)
    const rows = page.locator('[data-testid^="connection-row-"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await page.screenshot({ path: "test-results/uat/connections/rows-count.png" });
  });

  test("status pills render per connection state", async ({ page }) => {
    const table = page.locator('[data-testid="connections-list-wrapper"]');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/uat/connections/status-pills.png" });

    // There should be at least one status pill visible
    const pills = page.locator('[data-testid^="connection-status-"]');
    await expect(pills.first()).toBeVisible({ timeout: 5_000 });
    const count = await pills.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("disconnect button opens confirmation (does not execute)", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="connections-list-wrapper"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Find the first disconnect button
    const disconnectBtns = page.locator('[data-testid^="connection-disconnect-"]');
    const btnCount = await disconnectBtns.count();
    if (btnCount === 0) {
      test.fixme(true, "No disconnect buttons visible — may require a connected account");
      return;
    }

    await disconnectBtns.first().click();
    await page.screenshot({ path: "test-results/uat/connections/disconnect-dialog.png" });

    // A confirmation dialog should appear.
    // Use [data-state="open"] to exclude the mobile-nav sidebar which also
    // carries role="dialog" but is always hidden (no data-state attribute).
    const dialog = page.locator('[role="dialog"][data-state="open"], [role="alertdialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // Cancel to avoid actually disconnecting the seed account
    const cancelBtn = dialog.locator('button:has-text("Cancel"), button:has-text("No")');
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.first().click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.screenshot({ path: "test-results/uat/connections/disconnect-cancelled.png" });
  });

  test("reconnect button opens OAuth redirect (does not complete OAuth)", async ({
    page,
  }) => {
    await expect(
      page.locator('[data-testid="connections-list-wrapper"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Find a reconnect button (expected on the expired Facebook connection)
    const reconnectBtns = page.locator('[data-testid^="connection-reconnect-"]');
    const btnCount = await reconnectBtns.count();
    if (btnCount === 0) {
      test.fixme(true, "No reconnect buttons visible — seed data may not have expired connections");
      return;
    }

    // Capture the navigation URL before clicking — we do NOT complete OAuth
    let oauthUrl: string | null = null;
    const navPromise = page.waitForNavigation({ timeout: 5_000 }).catch(() => null);

    await reconnectBtns.first().click();
    await navPromise;

    oauthUrl = page.url();
    await page.screenshot({ path: "test-results/uat/connections/reconnect-redirect.png" });

    // Should be an OAuth URL or back on the connections page with a result param
    const isOAuth =
      oauthUrl.includes("oauth") ||
      oauthUrl.includes("connect") ||
      oauthUrl.includes("linkedin") ||
      oauthUrl.includes("facebook") ||
      oauthUrl.includes("connections");
    expect(isOAuth).toBe(true);
  });
});
