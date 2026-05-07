import { expect, test, type Page } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// Spec 01 §3.2 — Playwright happy path for the super_admin Delete
// (purge) action. The seeded E2E admin user IS the super_admin per
// the test fixtures, so the dropdown shows the Delete item.

async function stubTestConnection(page: Page): Promise<void> {
  await page.route("**/api/sites/test-connection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        user: {
          display_name: "E2E WP Admin",
          username: "wpadmin",
          roles: ["administrator"],
        },
      }),
    });
  });
}

async function createDisposableSite(page: Page, name: string): Promise<void> {
  await page.goto("/admin/sites/new");
  await page.getByTestId("site-name").fill(name);
  await page.getByTestId("site-wp-url").fill("https://purge-target.test");
  await page.getByTestId("site-wp-user").fill("wp");
  await page.getByTestId("site-wp-password").fill("password-1234");
  await page.getByTestId("site-test-connection").click();
  await expect(page.getByTestId("site-test-result")).toContainText(
    /Connected as/i,
  );
  await page.getByTestId("site-create-save").click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/onboarding/);
}

test.describe("Spec 01 — sites admin: Delete (purge) happy path", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubTestConnection(page);
  });

  test("super_admin → row dropdown → Delete → confirm → row gone", async ({
    page,
  }, testInfo) => {
    const disposableName = `Purge Target ${Date.now()}`;
    await createDisposableSite(page, disposableName);

    await page.goto("/admin/sites");
    await auditA11y(page, testInfo);

    const row = page.getByRole("row", { name: new RegExp(disposableName) });
    await expect(row).toBeVisible();

    await row.getByTestId("site-actions-summary").click();
    await row.getByTestId("site-delete-action").click();

    const confirmDialog = page.getByRole("dialog", {
      name: /delete site permanently/i,
    });
    await expect(confirmDialog).toBeVisible();
    await expect(confirmDialog).toContainText(disposableName);
    await confirmDialog
      .getByRole("button", { name: /delete permanently/i })
      .click();

    // Row is gone after the cascade returns.
    await expect(row).toHaveCount(0);
  });
});
