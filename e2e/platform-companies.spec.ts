import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// P3-1 + P3-2 — Opollo admin companies list + create flow.
// Logged-in admin can navigate to /admin/companies, see the list,
// click "New company" to land on the form, and submit a new row that
// appears in the list after refresh.

test.describe("platform admin / companies", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("list page renders + heading + a11y", async ({ page }, testInfo) => {
    await page.goto("/admin/companies");
    await expect(
      page.getByRole("heading", { name: /Companies/i }),
    ).toBeVisible();

    const addButton = page.getByTestId("add-company-button");
    await expect(addButton).toBeVisible();
    await expect(addButton).not.toBeDisabled();

    await auditA11y(page, testInfo);
  });

  test("create form opens, submits, new row appears in list", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/companies");

    await page.getByTestId("add-company-button").click();
    await page.waitForURL("**/admin/companies/new");
    await expect(
      page.getByRole("heading", { name: /New company/i }),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    const slug = `e2e-${Date.now()}`;
    await page.getByTestId("company-name").fill(`E2E Test Co ${slug}`);
    await page.getByTestId("company-slug").fill(slug);
    await page.getByTestId("company-domain").fill(`${slug}.test`);
    await page.getByTestId("company-create-submit").click();

    await page.waitForURL("**/admin/companies");
    await expect(
      page.getByTestId(`platform-company-row-${slug}`),
    ).toBeVisible();
  });
});
