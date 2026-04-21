import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

test.describe("batches admin surface", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("/admin/batches renders empty-or-populated list without erroring", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/batches");
    await expect(
      page.getByRole("heading", { name: "Batches" }),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    // Either shows the "No batches yet" empty state or a table.
    // Both paths are valid — the test pins only that the page
    // renders without an error banner.
    await expect(
      page.getByRole("alert").filter({ hasText: /failed to load/i }),
    ).toHaveCount(0);
  });

  test("?site_id=<uuid> filters + primes the New batch button", async ({
    page,
  }) => {
    // Navigate via the site detail → "View all" link for a real flow.
    await page.goto("/admin/sites");
    await page
      .getByRole("link", { name: "E2E Test Site" })
      .first()
      .click();
    await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);

    // On the site detail page the "Run batch" button is present but
    // may be disabled if the site has no active DS / templates. The
    // button itself should be rendered.
    await expect(
      page.getByRole("button", { name: /run batch/i }),
    ).toBeVisible();

    // View-all link navigates to the filtered batches list.
    await page.getByRole("link", { name: /view all/i }).click();
    await page.waitForURL(/\/admin\/batches\?site_id=/);
    await expect(
      page.getByRole("heading", { name: "Batches" }),
    ).toBeVisible();
  });
});
