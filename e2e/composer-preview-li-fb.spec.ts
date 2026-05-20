import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 3.2 / B3 — LinkedIn + Facebook preview cards
//
// Verifies that when a LinkedIn or Facebook connection is selected, the
// composer right pane renders the appropriate platform preview card with:
//   - avatar area  (data-testid="li-preview-avatar" / "fb-preview-avatar")
//   - account name (data-testid="li-preview-name" / "fb-preview-name")
//   - body content (data-testid="li-preview-body" / "fb-preview-body")
//   - action row   (data-testid="li-preview-actions" / "fb-preview-actions")
// ---------------------------------------------------------------------------

const MOCK_LI_CONNECTION = {
  id: "conn-li-001",
  platform: "linkedin",
  account_name: "Acme LinkedIn",
  account_avatar_url: null,
  display_name: "Acme LinkedIn",
};

const MOCK_FB_CONNECTION = {
  id: "conn-fb-001",
  platform: "facebook",
  account_name: "Acme Facebook",
  account_avatar_url: null,
  display_name: "Acme Facebook",
};

test.describe("composer preview cards — LinkedIn + Facebook (B3)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    // Provide two mock connections
    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { connections: [MOCK_LI_CONNECTION, MOCK_FB_CONNECTION] },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  });

  test("(PV-1) LinkedIn card — avatar, name, body, action row all present", async ({ page }) => {
    // Select LinkedIn chip
    await page.getByRole("checkbox", { name: /Post to Acme LinkedIn/i }).click();

    // Type content so preview renders it
    const textarea = page.getByTestId("content-textarea");
    await textarea.fill("Test LinkedIn post content");

    // Preview card should be visible
    const card = page.getByTestId("li-preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Avatar
    await expect(card.getByTestId("li-preview-avatar")).toBeVisible();
    // Name
    await expect(card.getByTestId("li-preview-name")).toHaveText("Acme LinkedIn");
    // Body
    await expect(card.getByTestId("li-preview-body")).toHaveText(
      "Test LinkedIn post content",
    );
    // Action row
    await expect(card.getByTestId("li-preview-actions")).toBeVisible();
    await expect(card.getByRole("button", { name: "Like" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Comment" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Repost" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Send" })).toBeVisible();
  });

  test("(PV-2) Facebook card — avatar, name, body, action row all present", async ({ page }) => {
    // Select Facebook chip
    await page.getByRole("checkbox", { name: /Post to Acme Facebook/i }).click();

    // Type content
    const textarea = page.getByTestId("content-textarea");
    await textarea.fill("Test Facebook post content");

    // Switch preview to Facebook (it's the only selected connection)
    const card = page.getByTestId("fb-preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    // Avatar
    await expect(card.getByTestId("fb-preview-avatar")).toBeVisible();
    // Name
    await expect(card.getByTestId("fb-preview-name")).toHaveText("Acme Facebook");
    // Body
    await expect(card.getByTestId("fb-preview-body")).toHaveText(
      "Test Facebook post content",
    );
    // Action row
    await expect(card.getByTestId("fb-preview-actions")).toBeVisible();
    await expect(card.getByRole("button", { name: "Like" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Comment" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Share" })).toBeVisible();
  });

  test("(PV-3) switching between LinkedIn and Facebook shows correct card", async ({ page }) => {
    // Select both
    await page.getByRole("checkbox", { name: /Post to Acme LinkedIn/i }).click();
    await page.getByRole("checkbox", { name: /Post to Acme Facebook/i }).click();

    // Default preview is LinkedIn (first selected)
    await expect(page.getByTestId("li-preview-card")).toBeVisible({ timeout: 5_000 });

    // Switch to Facebook
    await page.getByRole("button", { name: "Acme Facebook" }).click();
    await expect(page.getByTestId("fb-preview-card")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("li-preview-card")).not.toBeVisible();
  });
});
