import { createClient } from "@supabase/supabase-js";
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
// We query the e2e customer company id via service-role rather than
// scraping the /admin/companies list — the list uses a DataTable with
// onRowClick (no per-row testid) and the slug-based testid that the
// older platform-companies.spec.ts relies on is stale (TODO #820).
// ---------------------------------------------------------------------------

async function readCustomerCompanyId(): Promise<string> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — global-setup should have set these.");
  }
  const svc = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await svc
    .from("platform_companies")
    .select("id")
    .eq("slug", E2E_CUSTOMER_COMPANY_SLUG)
    .single();
  if (error || !data) {
    throw new Error(`failed to read e2e customer company: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

test.describe("admin / social profiles", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("list, add, promote, delete happy path", async ({ page }, testInfo) => {
    const companyId = await readCustomerCompanyId();

    // Navigate directly to the social profiles page.
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
    // button. Use the first visible Delete button.
    page.on("dialog", (dialog) => {
      void dialog.accept();
    });
    const firstDelete = page.locator('[data-testid^="profile-delete-"]').first();
    await expect(firstDelete).toBeVisible({ timeout: 5_000 });
    await firstDelete.click();

    // After delete, only the new (default) profile remains.
    await expect(page.getByTestId(`profile-row-${newRowId}`)).toBeVisible();
    await expect(defaultPills).toHaveCount(1);
  });
});
