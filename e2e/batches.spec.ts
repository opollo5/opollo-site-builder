import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

test.describe("batches admin surface", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("/admin/batches renders empty state (no site selected)", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/batches");
    await expect(page.getByRole("heading", { name: "Batches" })).toBeVisible();
    // Empty state: "Select a site to continue"
    await expect(page.getByText(/select a site to continue/i)).toBeVisible();
    await expect(
      page.getByRole("alert").filter({ hasText: /failed to load/i }),
    ).toHaveCount(0);
    await auditA11y(page, testInfo);
  });

  test("site detail 'View all' link navigates to /admin/batches/[siteId]", async ({
    page,
  }) => {
    await page.goto("/admin/sites");
    await page.getByRole("link", { name: "E2E Test Site" }).first().click();
    await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);

    await expect(page.getByRole("button", { name: /run batch/i })).toBeVisible();

    await page.getByRole("link", { name: /view all/i }).click();
    // URL should be /admin/batches/<siteUuid> — no query param.
    await page.waitForURL(/\/admin\/batches\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: /batches/i })).toBeVisible();
  });

  test("?site_id= query param 308-redirects to /admin/batches/[siteId]", async ({
    page,
  }) => {
    // Get a real siteId from the site detail page.
    await page.goto("/admin/sites");
    await page.getByRole("link", { name: "E2E Test Site" }).first().click();
    await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
    const match = /\/admin\/sites\/([0-9a-f-]{36})$/.exec(page.url());
    const siteId = match?.[1];
    if (!siteId) throw new Error("Could not extract siteId");

    await page.goto(`/admin/batches?site_id=${siteId}`);
    await page.waitForURL(/\/admin\/batches\/[0-9a-f-]{36}$/);
    expect(page.url()).toContain(`/admin/batches/${siteId}`);
  });
});
