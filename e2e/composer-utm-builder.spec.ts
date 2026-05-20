import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: UTM builder rebuild (Phase 4.3 / B5)
//
// Covers:
//  UT-1: Open UTM panel → all inputs visible
//  UT-2: Set campaign → live preview URL contains utm_campaign
//  UT-3: Insert URL → UTM URL appears in textarea
//  UT-4: Advanced section toggle shows content + term inputs
//  UT-5: Close button dismisses panel
// ---------------------------------------------------------------------------

async function openComposerUtmPanel(page: import("@playwright/test").Page) {
  await page.goto("/company/social/calendar?compose=new");
  const dialog = page.getByRole("dialog", { name: /new post/i });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  const utmBtn = dialog.getByTestId("composer-tool-utm");
  await expect(utmBtn).toBeVisible({ timeout: 10_000 });
  await utmBtn.click();
  await expect(dialog.getByTestId("utm-builder-panel")).toBeVisible({ timeout: 2_000 });
  return dialog;
}

test.describe("UTM builder (Phase 4.3)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("UT-1: opens UTM panel with all fields", async ({ page }) => {
    const dialog = await openComposerUtmPanel(page);
    expect(await dialog.getByTestId("utm-url-input").isVisible()).toBe(true);
    expect(await dialog.getByTestId("utm-campaign-input").isVisible()).toBe(true);
    expect(await dialog.getByTestId("utm-medium-input").isVisible()).toBe(true);
    expect(await dialog.getByTestId("utm-source-input").isVisible()).toBe(true);
  });

  test("UT-2: live preview updates when campaign is set", async ({ page }) => {
    const dialog = await openComposerUtmPanel(page);

    await dialog.getByTestId("utm-url-input").fill("https://example.com");
    await dialog.getByTestId("utm-campaign-input").fill("test-may26");

    const preview = dialog.getByTestId("utm-preview");
    await expect(preview).toBeVisible({ timeout: 1_000 });
    await expect(preview).toContainText("utm_campaign");
    await expect(preview).toContainText("test-may26");
  });

  test("UT-3: clicking Insert URL puts UTM URL in textarea", async ({ page }) => {
    const dialog = await openComposerUtmPanel(page);

    await dialog.getByTestId("utm-url-input").fill("https://example.com/page");
    await dialog.getByTestId("utm-campaign-input").fill("test-may26");
    await dialog.getByTestId("utm-insert-button").click();

    // Panel should close
    await expect(dialog.getByTestId("utm-builder-panel")).not.toBeVisible({ timeout: 1_000 });

    // Textarea should contain the UTM URL
    const textarea = dialog.getByTestId("content-textarea");
    const textValue = await textarea.inputValue();
    expect(textValue).toContain("utm_campaign=test-may26");
  });

  test("UT-4: advanced section toggle shows content + term inputs", async ({ page }) => {
    const dialog = await openComposerUtmPanel(page);

    await expect(dialog.getByTestId("utm-advanced-section")).not.toBeVisible();
    await dialog.getByTestId("utm-advanced-toggle").click();
    await expect(dialog.getByTestId("utm-advanced-section")).toBeVisible({ timeout: 1_000 });
    await expect(dialog.getByTestId("utm-content-input")).toBeVisible();
    await expect(dialog.getByTestId("utm-term-input")).toBeVisible();
  });

  test("UT-5: close button dismisses the UTM panel", async ({ page }) => {
    const dialog = await openComposerUtmPanel(page);
    await dialog.getByRole("button", { name: /close utm panel/i }).click();
    await expect(dialog.getByTestId("utm-builder-panel")).not.toBeVisible({ timeout: 1_000 });
  });
});
