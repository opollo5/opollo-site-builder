import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// P3-1 — Opollo admin companies list page.
// Logged-in admin can navigate to /admin/companies and see the list.
// Create-flow (P3-2), detail (P3-3), and invite (P3-4) are deferred.

test.describe("platform admin / companies", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("list page renders + heading + a11y", async ({ page }, testInfo) => {
    await page.goto("/admin/companies");
    await expect(
      page.getByRole("heading", { name: /Companies/i }),
    ).toBeVisible();

    // The "New company (P3-2)" button is a placeholder until the create
    // flow lands; assert it's present and disabled so a regression in
    // either direction (misnamed test-id, accidentally enabled) is loud.
    const addButton = page.getByTestId("add-company-button");
    await expect(addButton).toBeVisible();
    await expect(addButton).toBeDisabled();

    await auditA11y(page, testInfo);
  });
});
