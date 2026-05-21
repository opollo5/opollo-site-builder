import { test, expect } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// PR-D1 — Composer affordances: tooltips, dialog rewrite, header chrome
//
// Tests:
//  D1-1  Disabled submit button shows tooltip "Select at least one account"
//  D1-2  Profile chip shows "Click to select" tooltip when none are selected
//  D1-3  Profile chip tooltip disappears after selecting a chip
//  D1-4  Back button opens UnsavedChangesDialog when composer is dirty
//  D1-5  UnsavedChangesDialog shows correct title + button order
//  D1-6  "Continue editing" dismisses dialog, keeps composer open
// ---------------------------------------------------------------------------

const MOCK_CONN = {
  id: "conn-d1-linkedin",
  platform: "linkedin",
  account_name: "Acme LinkedIn",
  account_avatar_url: null,
};

test.describe("PR-D1 composer affordances", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    await page.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [MOCK_CONN] } }),
      });
    });
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });
  });

  test("(D1-1) disabled submit button shows tooltip when no profile selected", async ({ page }) => {
    const submitBtn = page.getByTestId("composer-submit");
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await expect(submitBtn).toBeDisabled();

    // The button is wrapped in a span TooltipTrigger — hover the wrapping span
    const trigger = page.locator('[data-testid="composer-submit"]').locator("..");
    await trigger.hover();
    await page.waitForTimeout(400);

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Select at least one account");
  });

  test("(D1-2) profile chip shows 'Click to select' tooltip when none selected", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    await chip.hover();
    await page.waitForTimeout(400);

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Click to select");
  });

  test("(D1-3) chip tooltip disappears after a chip is selected", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // Select the chip
    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");

    // Hover — tooltip should NOT appear now that a chip is selected
    await chip.hover();
    await page.waitForTimeout(400);

    const tooltip = page.locator('[role="tooltip"]:has-text("Click to select")');
    await expect(tooltip).toHaveCount(0);
  });

  test("(D1-4) Back button triggers UnsavedChangesDialog when dirty", async ({ page }) => {
    // Make the composer dirty by typing content
    const editor = page.locator('[data-testid="composer-editor"] [contenteditable]');
    if (await editor.count() > 0) {
      await editor.click();
      await editor.type("Draft content for unsaved test");
    } else {
      // Fallback: select a profile to make isDirty() return true
      const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
      if (await chip.count() > 0) await chip.click();
    }

    const backBtn = page.getByTestId("composer-back-btn");
    await expect(backBtn).toBeVisible({ timeout: 5_000 });
    await backBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
  });

  test("(D1-5) UnsavedChangesDialog has correct title and button order", async ({ page }) => {
    // Make dirty
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    if (await chip.count() > 0) await chip.click();

    const backBtn = page.getByTestId("composer-back-btn");
    await expect(backBtn).toBeVisible({ timeout: 5_000 });
    await backBtn.click();

    // Title
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole("heading")).toContainText("Do you want to save your changes?");

    // Button order: Save | Continue editing | Don't save
    const saveBtn = page.getByTestId("unsaved-save-btn");
    const continueBtn = page.getByTestId("unsaved-continue-btn");
    const discardBtn = page.getByTestId("unsaved-discard-btn");

    await expect(saveBtn).toBeVisible();
    await expect(continueBtn).toBeVisible();
    await expect(discardBtn).toBeVisible();

    // Verify DOM order: save appears before continue, continue before discard
    const allButtons = dialog.locator("button");
    const texts = await allButtons.allTextContents();
    const saveIdx = texts.findIndex((t) => t.includes("Save"));
    const continueIdx = texts.findIndex((t) => t.includes("Continue editing"));
    const discardIdx = texts.findIndex((t) => t.includes("Don't save"));
    expect(saveIdx).toBeLessThan(continueIdx);
    expect(continueIdx).toBeLessThan(discardIdx);
  });

  test("(D1-6) 'Continue editing' dismisses dialog, keeps composer open", async ({ page }) => {
    // Make dirty
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    if (await chip.count() > 0) await chip.click();

    await page.getByTestId("composer-back-btn").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("unsaved-continue-btn").click();

    // Dialog should be gone, composer overlay should still be visible
    await expect(dialog.getByRole("heading")).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("composer-overlay")).toBeVisible();
  });
});
