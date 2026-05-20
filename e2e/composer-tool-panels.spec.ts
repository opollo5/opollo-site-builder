import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: composer tool panel mutual exclusion + keyboard dismiss (A4)
//
// Phase 2.1 of the social-composer-v3 rebuild.
//
// ToolsRow already uses single `activePanel` state for mutual exclusion.
// This PR adds:
//   - Esc key → close active panel
//   - Click outside → close active panel
//   - Lucide icons instead of inline SVGs
//   - data-testid attributes for reliable automation
//
// All tests run against the real customer route with mocked draft APIs.
// ---------------------------------------------------------------------------

async function openComposer(page: import("@playwright/test").Page) {
  await page.goto("/company/social/calendar?compose=new");
  const dialog = page.getByRole("dialog", { name: /new post/i });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return dialog;
}

test.describe("composer tool panels — mutual exclusion + dismiss (A4)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("clicking AI opens AI panel and hides other panels", async ({ page }) => {
    const dialog = await openComposer(page);

    const aiBtn = dialog.getByTestId("composer-tool-ai");
    await expect(aiBtn).toBeVisible({ timeout: 10_000 });

    await aiBtn.click();
    // Panels portal to document.body — use page.getByTestId, not dialog.getByTestId
    await expect(page.getByTestId("composer-panel-ai")).toBeVisible();
    await expect(page.getByTestId("composer-panel-emoji")).not.toBeVisible();
    await expect(page.getByTestId("composer-panel-gif")).not.toBeVisible();
    await expect(page.getByTestId("composer-panel-utm")).not.toBeVisible();
  });

  test("clicking Emoji closes AI and opens Emoji panel", async ({ page }) => {
    const dialog = await openComposer(page);

    const aiBtn = dialog.getByTestId("composer-tool-ai");
    const emojiBtn = dialog.getByTestId("composer-tool-emoji");
    await expect(aiBtn).toBeVisible({ timeout: 10_000 });

    // Open AI first
    await aiBtn.click();
    await expect(page.getByTestId("composer-panel-ai")).toBeVisible();

    // Switch to Emoji — AI must close, Emoji must open
    await emojiBtn.click();
    await expect(page.getByTestId("composer-panel-emoji")).toBeVisible();
    await expect(page.getByTestId("composer-panel-ai")).not.toBeVisible();
  });

  test("clicking the active tool button again closes the panel (toggle off)", async ({ page }) => {
    const dialog = await openComposer(page);

    const emojiBtn = dialog.getByTestId("composer-tool-emoji");
    await expect(emojiBtn).toBeVisible({ timeout: 10_000 });

    await emojiBtn.click();
    await expect(page.getByTestId("composer-panel-emoji")).toBeVisible();

    // Click same button again — panel closes
    await emojiBtn.click();
    await expect(page.getByTestId("composer-panel-emoji")).not.toBeVisible();
  });

  test("Esc key closes the active panel", async ({ page }) => {
    const dialog = await openComposer(page);

    const utmBtn = dialog.getByTestId("composer-tool-utm");
    await expect(utmBtn).toBeVisible({ timeout: 10_000 });

    await utmBtn.click();
    await expect(page.getByTestId("composer-panel-utm")).toBeVisible();

    // Esc dismisses the panel
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("composer-panel-utm")).not.toBeVisible();
  });

  test("all five tool buttons render in the toolbar", async ({ page }) => {
    const dialog = await openComposer(page);

    const toolbar = dialog.getByTestId("composer-tools-toolbar");
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    for (const id of ["ai", "media", "emoji", "gif", "utm"]) {
      await expect(dialog.getByTestId(`composer-tool-${id}`)).toBeVisible();
    }
  });
});
