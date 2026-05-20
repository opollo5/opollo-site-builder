import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: composer link preview card (B4 / Phase 4.2)
//
// Covers:
//  LP-1: Pasting a URL into the textarea shows the link preview card
//         within 3 s (API calls the live link-preview endpoint).
//  LP-2: Clicking the dismiss button removes the card.
//  LP-3: Deleting the URL from the textarea removes the card.
//  LP-4: Preview is NOT shown when URL is already dismissed for that URL.
// ---------------------------------------------------------------------------

async function openComposer(page: import("@playwright/test").Page) {
  await page.goto("/company/social/calendar?compose=new");
  const dialog = page.getByRole("dialog", { name: /new post/i });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return dialog;
}

test.describe("composer link preview (B4)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("LP-1: pasting a URL triggers a link preview card", async ({ page }) => {
    const dialog = await openComposer(page);

    const textarea = dialog.getByTestId("content-textarea");
    await expect(textarea).toBeVisible({ timeout: 10_000 });

    // Use example.com — always returns HTML; OG fallback will use <title>
    await textarea.fill("Check this out https://example.com");

    // The preview card should appear within 3 s (debounce + fetch)
    await expect(dialog.getByTestId("link-preview-card")).toBeVisible({ timeout: 3_000 });

    // Domain link should contain example.com
    const domainEl = dialog.getByTestId("link-preview-domain");
    await expect(domainEl).toContainText("example.com");
  });

  test("LP-2: clicking dismiss removes the card", async ({ page }) => {
    const dialog = await openComposer(page);

    const textarea = dialog.getByTestId("content-textarea");
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill("Check this out https://example.com");

    await expect(dialog.getByTestId("link-preview-card")).toBeVisible({ timeout: 3_000 });

    await dialog.getByTestId("link-preview-dismiss").click();
    await expect(dialog.getByTestId("link-preview-card")).not.toBeVisible({ timeout: 1_000 });
  });

  test("LP-3: clearing the URL from the textarea hides the card", async ({ page }) => {
    const dialog = await openComposer(page);

    const textarea = dialog.getByTestId("content-textarea");
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill("https://example.com");

    await expect(dialog.getByTestId("link-preview-card")).toBeVisible({ timeout: 3_000 });

    // Replace with a plain text string that has no URL
    await textarea.fill("No link here");
    await expect(dialog.getByTestId("link-preview-card")).not.toBeVisible({ timeout: 2_000 });
  });

  test("LP-4: dismissing then re-typing the same URL does not re-show the card", async ({ page }) => {
    const dialog = await openComposer(page);

    const textarea = dialog.getByTestId("content-textarea");
    await expect(textarea).toBeVisible({ timeout: 10_000 });
    await textarea.fill("https://example.com");

    await expect(dialog.getByTestId("link-preview-card")).toBeVisible({ timeout: 3_000 });

    // Dismiss
    await dialog.getByTestId("link-preview-dismiss").click();
    await expect(dialog.getByTestId("link-preview-card")).not.toBeVisible({ timeout: 1_000 });

    // Retype the same URL — should NOT re-trigger
    await textarea.fill("");
    await textarea.fill("https://example.com again");
    await page.waitForTimeout(600); // debounce + render time
    await expect(dialog.getByTestId("link-preview-card")).not.toBeVisible();
  });
});
