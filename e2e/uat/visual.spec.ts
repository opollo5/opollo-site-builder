import { test, expect } from "@playwright/test";
import { signInAsUatBot, UAT_BASE_URL } from "./helpers/auth";
import { collectConsole, saveFailureReport } from "./helpers/report";

// ---------------------------------------------------------------------------
// P1 — Visual regression baselines
// Baseline snapshots live in e2e/uat/__screenshots__/ and are captured on the
// CI Linux runner only. Use --update-snapshots (regen-baselines commit msg) to
// regenerate. maxDiffPixels: 100 is set in playwright.uat.config.ts.
// ---------------------------------------------------------------------------

test.describe("P1 — Visual regression", () => {
  let consoleMessages: string[];

  test.beforeEach(async ({ page }) => {
    consoleMessages = collectConsole(page);
    await signInAsUatBot(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await saveFailureReport(page, testInfo, { consoleMessages });
  });

  test("calendar grid — current month render", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/calendar`);

    // calendar-grid is the inner role="grid" (SocialCalendarGrid.tsx:299);
    // calendar-shell is the outer wrapper. Visual diff targets the grid only.
    const grid = page.locator('[data-testid="calendar-grid"]');
    await expect(grid).toBeVisible({ timeout: 10_000 });

    // Mask dynamic date cells so today highlight doesn't break baselines
    await expect(grid).toHaveScreenshot("calendar-grid.png", {
      mask: [page.locator('[data-today="true"]')],
    });
  });

  test("composer overlay — open empty (new post)", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/calendar?compose=new`);
    const overlay = page.locator('[data-testid="composer-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    // Mask any animated or time-dependent elements
    await expect(overlay).toHaveScreenshot("composer-empty.png", {
      mask: [page.locator('[data-testid="composer-char-count"]')],
    });
  });

  test("composer overlay — open populated (chip click)", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/calendar`);
    // Wait for calendar to render before counting chips
    await expect(page.locator('[data-testid="calendar-shell"]')).toBeVisible({
      timeout: 15_000,
    });

    const chips = page.locator('[data-testid="post-chip"]');
    if ((await chips.count()) === 0) {
      test.fixme(
        true,
        "No post chips visible — seed data may be in a different month. Navigate to seeded month.",
      );
      return;
    }

    await chips.first().click();
    const overlay = page.locator('[data-testid="composer-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });
    await expect(overlay).toHaveScreenshot("composer-populated.png", {
      mask: [page.locator('[data-testid="composer-char-count"]')],
    });
  });

  test("AI assist dialog — open state", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/calendar?compose=new`);
    const overlay = page.locator('[data-testid="composer-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    const aiBtn = page.locator('[data-testid="composer-tool-ai"]');
    await expect(aiBtn).toBeVisible();
    await aiBtn.click();

    const aiPanel = page.locator('[data-testid="composer-panel-ai"]');
    await expect(aiPanel).toBeVisible({ timeout: 5_000 });
    await expect(aiPanel).toHaveScreenshot("ai-assist-dialog.png");
  });

  test("schedule tab — date picker", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/company/social/calendar?compose=new`);
    const overlay = page.locator('[data-testid="composer-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    const scheduleTab = page
      .locator('[role="tablist"] [role="tab"]')
      .filter({ hasText: /schedule/i });
    await expect(scheduleTab).toBeVisible();
    await scheduleTab.click();

    const dateInput = page.locator('[aria-label="Scheduled date"]');
    await expect(dateInput).toBeVisible({ timeout: 5_000 });
    // Mask the actual date value so baseline doesn't drift with time
    await expect(overlay.locator('[data-testid="schedule-card"], .schedule-card, [role="tabpanel"]').first()).toHaveScreenshot("schedule-date-picker.png", {
      mask: [dateInput],
    });
  });

  test("admin theming dashboard", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/admin/theming`);

    const url = page.url();
    if (!url.includes("/admin/theming")) {
      test.fixme(
        true,
        "UAT user may not have super_admin role required for /admin/theming — see KF-5",
      );
      return;
    }

    const main = page.locator("main, [role='main']").first();
    await expect(main).toHaveScreenshot("admin-theming.png", {
      mask: [page.locator("input[type='color']")],
    });
  });

  test("/admin/images library grid", async ({ page }) => {
    await page.goto(`${UAT_BASE_URL}/admin/images`);

    const url = page.url();
    if (!url.includes("/admin/images")) {
      test.fixme(
        true,
        "UAT user redirected away from /admin/images — may lack required role (see KF-5)",
      );
      return;
    }

    // image-library-grid is on the /admin/images grid view
    // (ImagesTable.tsx → ImageGrid); media-library-grid is the composer's
    // MediaPickerModal (a different surface). The spec targets the admin
    // page only.
    const grid = page.locator('[data-testid="image-library-grid"]');
    await expect(grid).toBeVisible({ timeout: 10_000 });
    await expect(grid).toHaveScreenshot("admin-image-library-grid.png");
  });
});
