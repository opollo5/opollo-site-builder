import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: preview card max-width cap (PR-A2)
//
// The preview card must render at most 480px wide regardless of how wide
// the right-pane container is. Verifies the max-w-[480px] constraint added
// to PreviewCard.tsx.
// ---------------------------------------------------------------------------

const MOCK_LI_CONNECTION = {
  id: "conn-li-001",
  platform: "linkedin",
  account_name: "Acme LinkedIn",
  account_avatar_url: null,
};

test.describe("preview card — max-width cap (A2)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    // page.route() takes priority over context.route() — override connections
    // to return a single LinkedIn connection so the preview card renders.
    await page.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [MOCK_LI_CONNECTION] } }),
      });
    });
  });

  test("PW-1: preview card is at most 480px wide", async ({ page }) => {
    await page.goto("/company/social/calendar?compose=new");

    const dialog = page.getByRole("dialog", { name: /new post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Select the LinkedIn account so the preview card renders.
    const chip = dialog.getByTestId("profile-chip-conn-li-001");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    const card = page.getByTestId("preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(480);
  });

  test("PW-2: preview card is still visible and not zero-width", async ({ page }) => {
    await page.goto("/company/social/calendar?compose=new");

    const dialog = page.getByRole("dialog", { name: /new post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const chip = dialog.getByTestId("profile-chip-conn-li-001");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    const card = page.getByTestId("preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
  });
});
