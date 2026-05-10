import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";
import { E2E_CUSTOMER_COMPANY_SLUG } from "./fixtures";

// ---------------------------------------------------------------------------
// BSP-5 — admin social-profiles management.
//
// Scope:
//   1. Page loads with the seeded default profile (backfilled by 0118).
//   2. Admin can add a new (non-default) profile.
//   3. Admin can promote it to default; old default flips to non-default.
//   4. Admin can delete a non-default profile.
//   5. auditA11y on the loaded page.
//
// Out of scope:
//   bundle.social team provisioning (BSP-6).
//   Customer-facing UI (this PR is operator-only).
// ---------------------------------------------------------------------------

test.describe("admin / social profiles", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("list, add, promote, delete happy path", async ({ page }, testInfo) => {
    // Look up the e2e customer company id by hitting /admin/companies and
    // grabbing the row testid. The seeded slug is deterministic.
    await page.goto("/admin/companies");
    const companyLink = page.getByTestId(
      `platform-company-link-${E2E_CUSTOMER_COMPANY_SLUG}`,
    );
    await expect(companyLink).toBeVisible({ timeout: 15_000 });
    const href = await companyLink.getAttribute("href");
    expect(href).toBeTruthy();
    const companyId = href!.split("/").pop()!;
    expect(companyId).toMatch(/^[0-9a-f-]{36}$/);

    // Navigate to the social profiles page.
    await page.goto(`/admin/companies/${companyId}/social-profiles`);
    await expect(
      page.getByRole("heading", { name: /Social profiles/i }),
    ).toBeVisible({ timeout: 15_000 });

    // Backfill should have created a default profile.
    await expect(page.getByTestId("profiles-table")).toBeVisible();
    const defaultPills = page.locator('[data-testid^="profile-default-pill-"]');
    await expect(defaultPills).toHaveCount(1);

    await auditA11y(page, testInfo);

    // Add a new executive profile.
    const uniqueName = `E2E Exec ${Date.now()}`;
    await page.getByTestId("new-profile-name-input").fill(uniqueName);
    await page.getByTestId("new-profile-kind-select").selectOption("executive");
    await page.getByTestId("add-profile-submit").click();

    // The new row appears.
    const newRowName = page.getByText(uniqueName, { exact: true });
    await expect(newRowName).toBeVisible({ timeout: 10_000 });

    // Find the row id by reading the ancestor's testid.
    const newRowId = await newRowName.evaluate((el) => {
      const tr = el.closest("[data-testid^='profile-row-']");
      return tr?.getAttribute("data-testid")?.replace("profile-row-", "") ?? null;
    });
    expect(newRowId).toBeTruthy();

    // Promote it to default.
    await page.getByTestId(`profile-set-default-${newRowId}`).click();

    // Wait for the default pill to appear on the new row.
    await expect(
      page.getByTestId(`profile-default-pill-${newRowId}`),
    ).toBeVisible({ timeout: 10_000 });

    // Old default should no longer have a pill — there's still exactly one
    // pill on the page.
    await expect(defaultPills).toHaveCount(1);

    // Delete the (now non-default) old profile by finding any "Delete"
    // button. Cypress-style chained selectors aren't great in Playwright;
    // use the first visible Delete button.
    page.on("dialog", (dialog) => dialog.accept()); // confirm() prompt
    const firstDelete = page.locator('[data-testid^="profile-delete-"]').first();
    await expect(firstDelete).toBeVisible({ timeout: 5_000 });
    await firstDelete.click();

    // After delete, only the new (default) profile remains.
    await expect(page.getByTestId(`profile-row-${newRowId}`)).toBeVisible();
    await expect(defaultPills).toHaveCount(1);
  });
});
