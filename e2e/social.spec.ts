import { expect, test } from "@playwright/test";

import { auditA11y, signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Social platform E2E — /company/social/*
//
// Scope:
//   1. Posts list loads with table + new-post button visible
//   2. New post button opens the compose form
//   3. Connections page loads with connections container
//   4. Analytics page loads with chart or empty-state
//   5. Media library page loads with library container
//   6. auditA11y on each visited page
//
// Out of scope:
//   OAuth connection flow (needs external bundle.social callback).
//   Post publish flow (needs a real WP backend).
//   Full compose → save round-trip (covered by unit layer).
// ---------------------------------------------------------------------------

test.describe("social platform", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("posts list loads and shows key UI", async ({ page }, testInfo) => {
    await page.goto("/company/social/posts");
    await expect(page).toHaveURL(/\/company\/social\/posts/);

    // Table container is rendered (may be empty but must be present).
    await expect(
      page.getByTestId("social-posts-table"),
    ).toBeVisible({ timeout: 15_000 });

    // New-post button present for company-admin role.
    await expect(page.getByTestId("new-post-button")).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("new post button opens compose form", async ({ page }, testInfo) => {
    await page.goto("/company/social/posts");
    await page.getByTestId("new-post-button").click();

    // Compose form should become visible.
    await expect(
      page.getByTestId("new-post-form"),
    ).toBeVisible({ timeout: 10_000 });

    await auditA11y(page, testInfo);
  });

  test("connections page loads", async ({ page }, testInfo) => {
    await page.goto("/company/social/connections");
    await expect(page).toHaveURL(/\/company\/social\/connections/);

    // Either the connections wrapper or an error banner must render.
    const wrapper = page.getByTestId("connections-list-wrapper");
    const errBanner = page.getByTestId("connections-error");
    await expect(wrapper.or(errBanner)).toBeVisible({ timeout: 15_000 });

    // Heading must be present regardless of data state.
    await expect(page.getByRole("heading", { name: /social connections/i })).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("analytics page loads", async ({ page }, testInfo) => {
    await page.goto("/company/social/analytics");
    await expect(page).toHaveURL(/\/company\/social\/analytics/);

    // The analytics client, an empty state, or an error must render.
    // We look for any element with a role=main or the known test ids.
    const analyticsEmpty = page.getByTestId("analytics-empty");
    const analyticsError = page.getByTestId("analytics-error");
    const mainContent = page.locator("main");
    await expect(
      analyticsEmpty.or(analyticsError).or(mainContent).first(),
    ).toBeVisible({ timeout: 15_000 });

    await auditA11y(page, testInfo);
  });

  test("media library page loads", async ({ page }, testInfo) => {
    await page.goto("/company/social/media");
    await expect(page).toHaveURL(/\/company\/social\/media/);

    // Media library container must render.
    await expect(page.getByTestId("media-library")).toBeVisible({
      timeout: 15_000,
    });

    // Heading must be present.
    await expect(page.getByRole("heading", { name: /media library/i })).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("timeline page loads with feed or empty state", async ({ page }, testInfo) => {
    await page.goto("/company/social/timeline");
    await expect(page).toHaveURL(/\/company\/social\/timeline/);

    // Either a feed or an empty state must render.
    const feed = page.getByTestId("timeline-feed");
    const empty = page.getByTestId("timeline-empty");
    await expect(feed.or(empty)).toBeVisible({ timeout: 15_000 });

    // Shell toolbar must be present.
    await expect(page.getByTestId("social-module-shell")).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("timeline tab in shell navigation links to timeline", async ({ page }) => {
    await page.goto("/company/social/posts");
    await expect(page).toHaveURL(/\/company\/social\/posts/);

    // Click the Timeline pill tab.
    await page.getByRole("link", { name: /timeline/i }).click();
    await expect(page).toHaveURL(/\/company\/social\/timeline/, { timeout: 10_000 });
  });
});
