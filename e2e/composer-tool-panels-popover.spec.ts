import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: composer tool panels render as popovers — layout regression (PR-A1)
//
// Verifies that opening a tool panel does NOT shift the scheduling / submit
// controls downward. Panels must float above the editor, not push content.
// ---------------------------------------------------------------------------

async function openComposer(page: import("@playwright/test").Page) {
  await page.goto("/company/social/calendar?compose=new");
  const dialog = page.getByRole("dialog", { name: /new post/i });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  // c3-modal-in entrance animation is 320ms scale(0.96→1). Wait for it to
  // finish before any bounding-box measurements so position reads are stable.
  await page.waitForTimeout(400);
  return dialog;
}

test.describe("composer tool panels — popover layout (A1)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("opening GIF panel does not shift submit button (Y-position stable)", async ({ page }) => {
    const dialog = await openComposer(page);

    const submitBtn = dialog.getByTestId("composer-submit");
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });

    // Record Y-position before opening any panel.
    const beforeBox = await submitBtn.boundingBox();
    expect(beforeBox).not.toBeNull();

    // Open the GIF panel.
    const gifBtn = dialog.getByTestId("composer-tool-gif");
    await expect(gifBtn).toBeVisible();
    await gifBtn.click();
    await expect(page.getByTestId("composer-panel-gif")).toBeVisible({ timeout: 5_000 });

    // Submit button Y must not have moved more than 2px.
    const afterBox = await submitBtn.boundingBox();
    expect(afterBox).not.toBeNull();
    expect(Math.abs(afterBox!.y - beforeBox!.y)).toBeLessThanOrEqual(2);

    // Close panel.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("composer-panel-gif")).not.toBeVisible();
    // Confirm tool button aria-expanded is false after close.
    await expect(gifBtn).toHaveAttribute("aria-expanded", "false");
  });

  test("GIF panel has position not in document normal flow (portaled)", async ({ page }) => {
    const dialog = await openComposer(page);

    const gifBtn = dialog.getByTestId("composer-tool-gif");
    await expect(gifBtn).toBeVisible({ timeout: 10_000 });
    await gifBtn.click();
    const panel = page.getByTestId("composer-panel-gif");
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // The panel should be detached from the dialog's DOM subtree (portaled to body).
    // Playwright: count of matching elements inside the dialog element should be 0.
    const panelInDialog = dialog.getByTestId("composer-panel-gif");
    await expect(panelInDialog).toHaveCount(0);

    await page.keyboard.press("Escape");
  });

  test("AI panel — submit Y stable", async ({ page }) => {
    const dialog = await openComposer(page);
    const submitBtn = dialog.getByTestId("composer-submit");
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    const beforeBox = await submitBtn.boundingBox();

    await dialog.getByTestId("composer-tool-ai").click();
    await expect(page.getByTestId("composer-panel-ai")).toBeVisible({ timeout: 5_000 });

    const afterBox = await submitBtn.boundingBox();
    expect(Math.abs(afterBox!.y - beforeBox!.y)).toBeLessThanOrEqual(2);

    await page.keyboard.press("Escape");
  });

  test("Emoji panel — submit Y stable", async ({ page }) => {
    const dialog = await openComposer(page);
    const submitBtn = dialog.getByTestId("composer-submit");
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    const beforeBox = await submitBtn.boundingBox();

    await dialog.getByTestId("composer-tool-emoji").click();
    await expect(page.getByTestId("composer-panel-emoji")).toBeVisible({ timeout: 5_000 });

    const afterBox = await submitBtn.boundingBox();
    expect(Math.abs(afterBox!.y - beforeBox!.y)).toBeLessThanOrEqual(2);

    await page.keyboard.press("Escape");
  });

  test("UTM panel — submit Y stable", async ({ page }) => {
    const dialog = await openComposer(page);
    const submitBtn = dialog.getByTestId("composer-submit");
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    const beforeBox = await submitBtn.boundingBox();

    await dialog.getByTestId("composer-tool-utm").click();
    await expect(page.getByTestId("composer-panel-utm")).toBeVisible({ timeout: 5_000 });

    const afterBox = await submitBtn.boundingBox();
    expect(Math.abs(afterBox!.y - beforeBox!.y)).toBeLessThanOrEqual(2);

    await page.keyboard.press("Escape");
  });
});
