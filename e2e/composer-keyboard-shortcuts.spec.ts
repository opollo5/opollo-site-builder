import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 6.1 — Composer keyboard shortcuts
//
// (KS-1) ? key shows/hides the shortcuts panel
// (KS-2) ⌘K focuses the content textarea
// (KS-3) ⌘E opens the emoji panel
// (KS-4) ⌘S saves as draft (triggers submit with mode=draft)
// ---------------------------------------------------------------------------

test.describe("composer keyboard shortcuts (phase 6.1)", () => {
  async function setup(page: import("@playwright/test").Page, context: import("@playwright/test").BrowserContext) {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  }

  test("(KS-1) ? key toggles the shortcuts panel", async ({ page, context }) => {
    await setup(page, context);

    // Panel hidden initially
    await expect(page.getByTestId("composer-shortcuts-panel")).not.toBeVisible();

    // Press ? — panel shows
    await page.keyboard.press("?");
    await expect(page.getByTestId("composer-shortcuts-panel")).toBeVisible({ timeout: 2_000 });
    // Confirm it lists at least one shortcut
    await expect(page.getByTestId("composer-shortcuts-panel")).toContainText("⌘↵");

    // Press ? again — panel hides
    await page.keyboard.press("?");
    await expect(page.getByTestId("composer-shortcuts-panel")).not.toBeVisible();
  });

  test("(KS-2) keyboard shortcuts button in header toggles panel", async ({ page, context }) => {
    await setup(page, context);

    await expect(page.getByTestId("composer-shortcuts-panel")).not.toBeVisible();
    await page.getByTestId("composer-shortcuts-btn").click();
    await expect(page.getByTestId("composer-shortcuts-panel")).toBeVisible({ timeout: 2_000 });
  });

  test("(KS-3) Cmd+K focuses the content textarea", async ({ page, context }) => {
    await setup(page, context);

    // Blur textarea first
    await page.keyboard.press("Tab");
    await page.keyboard.press("Meta+k");
    // Textarea should have focus
    const textarea = page.getByTestId("content-textarea");
    await expect(textarea).toBeFocused({ timeout: 2_000 });
  });

  test("(KS-4) Cmd+E opens the emoji panel", async ({ page, context }) => {
    await setup(page, context);

    await expect(page.getByTestId("composer-panel-emoji")).not.toBeVisible();
    await page.keyboard.press("Meta+e");
    await expect(page.getByTestId("composer-panel-emoji")).toBeVisible({ timeout: 2_000 });
  });
});
