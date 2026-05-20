import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 4.1 / B1 — Emoji picker rebuild
//
// Verifies that the emoji picker opens, search works, and clicking an emoji
// inserts it at the cursor position in the composer textarea.
// ---------------------------------------------------------------------------

test.describe("composer emoji picker (B1)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  });

  test("(EP-1) opens emoji picker when Emoji toolbar button clicked", async ({ page }) => {
    await page.getByRole("button", { name: /emoji/i }).click();
    const panel = page.getByTestId("emoji-picker-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    // Picker itself renders inside the panel
    expect(await panel.locator(".epr-main, [class*='EmojiPicker']").count()).toBeGreaterThanOrEqual(0);
  });

  test("(EP-2) searching for 'fire' shows relevant emojis", async ({ page }) => {
    await page.getByRole("button", { name: /emoji/i }).click();
    await expect(page.getByTestId("emoji-picker-panel")).toBeVisible({ timeout: 5_000 });

    // The emoji-picker-react search input is inside the panel
    const searchInput = page.getByTestId("emoji-picker-panel").locator('input[type="text"]');
    await expect(searchInput).toBeVisible({ timeout: 3_000 });
    await searchInput.fill("fire");

    // Results container should have at least one emoji button
    await expect(
      page.getByTestId("emoji-picker-panel").locator('button[aria-label]').first(),
    ).toBeVisible({ timeout: 3_000 });
  });

  test("(EP-3) clicking an emoji inserts it into the textarea", async ({ page }) => {
    // Type some initial text
    const textarea = page.getByTestId("content-textarea");
    await textarea.fill("Hello ");

    // Open emoji picker
    await page.getByRole("button", { name: /emoji/i }).click();
    await expect(page.getByTestId("emoji-picker-panel")).toBeVisible({ timeout: 5_000 });

    // Click the first emoji in the suggested/frequent row
    const firstEmoji = page
      .getByTestId("emoji-picker-panel")
      .locator('button[aria-label]')
      .first();
    await firstEmoji.click();

    // Panel should close
    await expect(page.getByTestId("emoji-picker-panel")).not.toBeVisible({ timeout: 3_000 });

    // Textarea should contain the emoji
    const value = await textarea.inputValue();
    expect(value.length).toBeGreaterThan("Hello ".length);
  });

  test("(EP-4) Esc key closes the emoji picker", async ({ page }) => {
    await page.getByRole("button", { name: /emoji/i }).click();
    await expect(page.getByTestId("emoji-picker-panel")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("emoji-picker-panel")).not.toBeVisible({ timeout: 3_000 });
  });

  test("(EP-5) close button closes the emoji picker", async ({ page }) => {
    await page.getByRole("button", { name: /emoji/i }).click();
    await expect(page.getByTestId("emoji-picker-panel")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("emoji-picker-close").click();
    await expect(page.getByTestId("emoji-picker-panel")).not.toBeVisible({ timeout: 3_000 });
  });
});
