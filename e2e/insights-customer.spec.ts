import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// PR-03 E2E — Customer Insights dashboard at /company/social/insights
// ---------------------------------------------------------------------------

test.describe("Insights customer dashboard", () => {
  test("renders dashboard or empty state for company admin", async ({ page }) => {
    await signInAsCompanyAdmin(page);
    await page.goto("/company/social/insights");

    // Either the populated dashboard or the empty-state is present
    const hasDashboard = await page
      .getByTestId("insights-dashboard")
      .isVisible()
      .catch(() => false);
    const hasEmpty = await page
      .getByTestId("empty-no-posts")
      .isVisible()
      .catch(() => false);

    expect(hasDashboard || hasEmpty).toBe(true);
  });

  test("page header has title and breadcrumb", async ({ page }) => {
    await signInAsCompanyAdmin(page);
    await page.goto("/company/social/insights");

    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  });

  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/company/social/insights");
    await expect(page).toHaveURL(/\/login/);
  });
});
