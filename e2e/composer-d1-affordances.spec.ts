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

    const tooltip = page.getByRole("tooltip", { name: /Select at least one account/i });
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
  });

  test("(D1-2) chip tooltip content is in DOM when no profiles selected", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // TooltipContent uses forceMount so it stays in the DOM even when closed.
    // This lets us assert presence without relying on hover/focus triggering the portal.
    const tooltip = page.getByTestId("chip-tooltip-conn-d1-linkedin");
    await expect(tooltip).toHaveCount(1, { timeout: 3_000 });
    await expect(tooltip).toContainText("Click to select");
  });

  test("(D1-3) chip tooltip removed from DOM after a chip is selected", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // Tooltip is present before any selection
    await expect(page.getByTestId("chip-tooltip-conn-d1-linkedin")).toHaveCount(1);

    // Select the chip — ProfileSelector removes the entire Tooltip.Root, unmounting the portal
    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");

    // forceMount only keeps it when Tooltip.Root is in the React tree;
    // when hasSelected=true the whole Tooltip component unmounts
    await expect(page.getByTestId("chip-tooltip-conn-d1-linkedin")).toHaveCount(0);
  });

  test("(D1-4) Back button triggers UnsavedChangesDialog when dirty", async ({ page }) => {
    // Select a chip to make isDirty() return true (target_profile_ids non-empty)
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    if (await chip.count() > 0) await chip.click();

    const backBtn = page.getByTestId("composer-back-btn");
    await expect(backBtn).toBeVisible({ timeout: 5_000 });
    await backBtn.click();

    // UnsavedChangesDialog specific buttons should appear
    await expect(page.getByTestId("unsaved-continue-btn")).toBeVisible({ timeout: 5_000 });
  });

  test("(D1-5) UnsavedChangesDialog has correct title and button order", async ({ page }) => {
    // Make dirty
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    if (await chip.count() > 0) await chip.click();

    await page.getByTestId("composer-back-btn").click();
    await expect(page.getByTestId("unsaved-continue-btn")).toBeVisible({ timeout: 5_000 });

    // Title: use heading role (unambiguous — only UnsavedChangesDialog has this heading)
    await expect(
      page.getByRole("heading", { name: /do you want to save your changes/i }),
    ).toBeVisible();

    // All three action buttons must exist
    await expect(page.getByTestId("unsaved-save-btn")).toBeVisible();
    await expect(page.getByTestId("unsaved-continue-btn")).toBeVisible();
    await expect(page.getByTestId("unsaved-discard-btn")).toBeVisible();

    // DOM order: Save before Continue editing before Don't save
    const saveBox = await page.getByTestId("unsaved-save-btn").boundingBox();
    const contBox = await page.getByTestId("unsaved-continue-btn").boundingBox();
    const discBox = await page.getByTestId("unsaved-discard-btn").boundingBox();
    expect(saveBox!.y).toBeLessThan(contBox!.y);
    expect(contBox!.y).toBeLessThan(discBox!.y);
  });

  test("(D1-6) 'Continue editing' dismisses dialog, keeps composer open", async ({ page }) => {
    // Make dirty
    const chip = page.getByTestId("profile-chip-conn-d1-linkedin");
    if (await chip.count() > 0) await chip.click();

    await page.getByTestId("composer-back-btn").click();
    await expect(page.getByTestId("unsaved-continue-btn")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("unsaved-continue-btn").click();

    // UnsavedChangesDialog gone, composer overlay still visible
    await expect(page.getByTestId("unsaved-continue-btn")).not.toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("composer-overlay")).toBeVisible();
  });
});
