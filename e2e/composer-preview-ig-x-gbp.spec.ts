import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 3.3 / B3 — Instagram, X, Google Business preview cards
//
// Verifies that when a connection is selected the composer right pane renders
// the appropriate platform preview card with its key elements.
// ---------------------------------------------------------------------------

const MOCK_IG_CONNECTION = {
  id: "conn-ig-001",
  platform: "instagram",
  account_name: "Acme Instagram",
  account_avatar_url: null,
  display_name: "Acme Instagram",
};

const MOCK_X_CONNECTION = {
  id: "conn-x-001",
  platform: "x",
  account_name: "Acme Corp",
  account_avatar_url: null,
  display_name: "Acme Corp",
};

const MOCK_GBP_CONNECTION = {
  id: "conn-gbp-001",
  platform: "google_business_profile",
  account_name: "Acme Store",
  account_avatar_url: null,
  display_name: "Acme Store",
};

test.describe("composer preview cards — Instagram, X, GBP (B3)", () => {
  async function setupWithConnections(
    page: import("@playwright/test").Page,
    context: import("@playwright/test").BrowserContext,
    connections: object[],
  ) {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { connections },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  }

  test("(PV-4) Instagram card — avatar, handle, no-image warning, actions", async ({
    page,
    context,
  }) => {
    await setupWithConnections(page, context, [MOCK_IG_CONNECTION]);

    await page.getByRole("checkbox", { name: /Post to Acme Instagram/i }).click();
    await page.getByTestId("content-textarea").fill("Test Instagram caption");

    const card = page.getByTestId("ig-preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    await expect(card.getByTestId("ig-preview-avatar")).toBeVisible();
    await expect(card.getByTestId("ig-preview-name")).toBeVisible();
    // No media: warning panel visible
    await expect(card.getByTestId("ig-preview-no-image")).toBeVisible();
    // Action row with Like, Comment, Save
    await expect(card.getByTestId("ig-preview-actions")).toBeVisible();
    await expect(card.getByRole("button", { name: "Like" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Comment" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Save" })).toBeVisible();
    // Caption body
    await expect(card.getByTestId("ig-preview-body")).toContainText("Test Instagram caption");
  });

  test("(PV-5) X card — avatar, name, handle, body, char counter, action row", async ({
    page,
    context,
  }) => {
    await setupWithConnections(page, context, [MOCK_X_CONNECTION]);

    await page.getByRole("checkbox", { name: /Post to Acme Corp/i }).click();
    const textarea = page.getByTestId("content-textarea");
    await textarea.fill("Test X post content");

    const card = page.getByTestId("x-preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    await expect(card.getByTestId("x-preview-avatar")).toBeVisible();
    await expect(card.getByTestId("x-preview-name")).toHaveText("Acme Corp");
    await expect(card.getByTestId("x-preview-handle")).toBeVisible();
    await expect(card.getByTestId("x-preview-body")).toContainText("Test X post content");
    // Char counter present and not in danger state
    const counter = card.getByTestId("x-preview-char-count");
    await expect(counter).toBeVisible();
    await expect(counter).not.toHaveClass(/text-red-500/);
    // 5-action row
    await expect(card.getByTestId("x-preview-actions")).toBeVisible();
    await expect(card.getByRole("button", { name: "Reply" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Repost" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Like" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Views" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Bookmark" })).toBeVisible();
  });

  test("(PV-6) GBP card — avatar, name, body, CTA button", async ({ page, context }) => {
    await setupWithConnections(page, context, [MOCK_GBP_CONNECTION]);

    await page.getByRole("checkbox", { name: /Post to Acme Store/i }).click();
    await page.getByTestId("content-textarea").fill("Test GBP post content");

    const card = page.getByTestId("gbp-preview-card");
    await expect(card).toBeVisible({ timeout: 5_000 });

    await expect(card.getByTestId("gbp-preview-avatar")).toBeVisible();
    await expect(card.getByTestId("gbp-preview-name")).toHaveText("Acme Store");
    await expect(card.getByTestId("gbp-preview-body")).toContainText("Test GBP post content");
    // CTA button with default label
    await expect(card.getByTestId("gbp-preview-cta")).toBeVisible();
    await expect(card.getByTestId("gbp-preview-cta")).toContainText("Learn more");
  });

  test("(PV-7) switching from Instagram to X shows correct card", async ({ page, context }) => {
    await setupWithConnections(page, context, [MOCK_IG_CONNECTION, MOCK_X_CONNECTION]);

    // Select Instagram first
    await page.getByRole("checkbox", { name: /Post to Acme Instagram/i }).click();
    await expect(page.getByTestId("ig-preview-card")).toBeVisible({ timeout: 5_000 });

    // Switch to X
    await page.getByRole("button", { name: "Acme Corp" }).click();
    await expect(page.getByTestId("x-preview-card")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("ig-preview-card")).not.toBeVisible();
  });
});
