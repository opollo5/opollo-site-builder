import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 3 — V2 composer mount regression.
//
// Verifies that ComposerOverlay (V2) is mounted on all three customer-facing
// social routes and opens when ?compose=new is added to the URL.
//
// Previously these routes served PostComposerModal (V1). This suite locks
// the V2 mount so it cannot silently regress.
// ---------------------------------------------------------------------------

test.describe("v2 composer mount — customer-facing routes", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  const ROUTES = [
    "/company/social/calendar",
    "/company/social/posts",
    "/company/social/timeline",
  ];

  for (const route of ROUTES) {
    test(`opens V2 ComposerOverlay at ${route}?compose=new`, async ({ page }) => {
      await page.goto(`${route}?compose=new`);

      // ComposerOverlay renders with aria-label="New post" (dynamic, set after V2 mount fix)
      const dialog = page.getByRole("dialog", { name: /new post/i });
      await expect(dialog).toBeVisible({ timeout: 20_000 });

      // V2 profile selector — circular icon chips row (aria-label="Add profile" chip is always present)
      await expect(dialog.getByRole("link", { name: /add profile/i })).toBeVisible({ timeout: 10_000 });

      // V2 SchedulingCard has "Post now" tab button
      await expect(dialog.getByRole("button", { name: /^post now$/i })).toBeVisible({ timeout: 10_000 });

      // V2 has content textarea
      await expect(dialog.locator("textarea").first()).toBeVisible({ timeout: 5_000 });

      // Close removes the compose param
      await dialog.getByRole("button", { name: /close composer/i }).click();
      await expect(dialog).not.toBeVisible({ timeout: 5_000 });
      await expect(page).not.toHaveURL(/compose=/);
    });
  }

  test("V2 right-pane preview tab is present", async ({ page }) => {
    await page.goto("/company/social/calendar?compose=new");

    const dialog = page.getByRole("dialog", { name: /new post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // ComposerOverlay right pane has "Post preview" and "Calendar" tabs
    await expect(page.getByRole("button", { name: /post preview/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^calendar$/i })).toBeVisible({ timeout: 10_000 });
  });

  test("pre-fills content when ?compose=<id> opens an existing draft", async ({ page, context }) => {
    const MOCK_DRAFT_ID = "b1e2c3d4-e5f6-7890-abcd-ef1234567890";
    const MOCK_CONTENT = "Pre-filled content from existing draft";

    // Mock the V1 draft API so the test doesn't need a real DB row.
    await context.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            id: MOCK_DRAFT_ID,
            draft_data: {
              master_text: MOCK_CONTENT,
              media_refs: [],
              target_connection_ids: [],
              approval_required: false,
            },
          },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);

    // Draft has an id → aria-label is "Edit post"
    const dialog = page.getByRole("dialog", { name: /edit post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Content textarea is pre-filled from the draft
    await expect(dialog.locator("textarea").first()).toHaveValue(MOCK_CONTENT, { timeout: 5_000 });
  });
});
