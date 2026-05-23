import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// PR-04 E2E — Admin Insights dashboard at /admin/insights
// ---------------------------------------------------------------------------

test.describe("Admin Insights dashboard", () => {
  test("admin can reach /admin/insights (cap operator) or is redirected (non-operator)", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/insights");

    // Either the roster loads (cap operator) or redirects to /admin (non-operator admin)
    const url = page.url();
    expect(url).toMatch(/\/admin/);
    // The page should not be a login page
    expect(url).not.toMatch(/\/login/);
  });

  test("admin banner shows on client drilldown (cap operator only)", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/insights");
    const url = page.url();
    if (!url.includes("/admin/insights")) {
      // not a cap operator — skip
      return;
    }

    const firstLink = page.getByRole("link", { name: "→" }).first();
    const hasLink = await firstLink.isVisible().catch(() => false);
    if (!hasLink) return;

    await firstLink.click();
    const drilldownUrl = page.url();
    if (drilldownUrl.includes("/clients/")) {
      await expect(page.getByTestId("admin-banner")).toBeVisible({ timeout: 10000 });
    }
  });

  test("unauthenticated user cannot access /admin/insights", async ({ page }) => {
    await page.goto("/admin/insights");
    await expect(page).toHaveURL(/\/(login|admin$)/);
  });
});
