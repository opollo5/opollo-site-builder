import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

test.describe("sites CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("sites list renders + row click lands on detail", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/sites");
    await auditA11y(page, testInfo);
    await expect(
      page.getByRole("heading", { name: "Manage sites" }),
    ).toBeVisible();

    // Seeded test site should appear (global-setup guarantees it).
    const siteRow = page.getByRole("row", { name: /E2E Test Site/i });
    await expect(siteRow).toBeVisible();

    // Clicking the site name link navigates to the detail page.
    await siteRow.getByRole("link", { name: "E2E Test Site" }).click();
    await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: "E2E Test Site" }),
    ).toBeVisible();
  });

  test("add new site — flows end-to-end without the prefix field", async ({
    page,
  }) => {
    await page.goto("/admin/sites");
    await page.getByRole("button", { name: /add new site/i }).click();

    const uniqueName = `Playwright Temp ${Date.now()}`;
    await page.getByLabel("Name").fill(uniqueName);
    await page.getByLabel("WordPress URL").fill("https://temp.test");
    await page.getByLabel("WordPress user").fill("wp-user");
    await page.getByLabel("WordPress app password").fill("password-1234");

    // Scope prefix field MUST NOT be present — M2d UX cleanup removed
    // it entirely in favour of server-side auto-generation.
    await expect(page.getByLabel(/scope prefix/i)).toHaveCount(0);

    await page.getByRole("button", { name: /register site/i }).click();

    // Modal closes on success and the new row appears after
    // revalidatePath('/admin/sites').
    await expect(page.getByText(uniqueName).first()).toBeVisible();
  });

  test("archive flow removes the site from the default list", async ({
    page,
  }) => {
    await page.goto("/admin/sites");

    // Create a throwaway site for this test so we don't archive the
    // shared e2e seed.
    const disposableName = `Archive Target ${Date.now()}`;
    await page.getByRole("button", { name: /add new site/i }).click();
    await page.getByLabel("Name").fill(disposableName);
    await page.getByLabel("WordPress URL").fill("https://archive-me.test");
    await page.getByLabel("WordPress user").fill("wp");
    await page.getByLabel("WordPress app password").fill("password-1234");
    await page.getByRole("button", { name: /register site/i }).click();

    // The modal closes + router.refresh re-renders the list. Wait for
    // the row to appear before hunting the actions menu — prior impl
    // used `getByText().first()` which didn't wait on the row locator
    // itself and raced the `<details>` mount.
    const row = page.getByRole("row", { name: new RegExp(disposableName) });
    await expect(row).toBeVisible();

    // Open the actions menu on the new row and archive.
    // <summary> elements don't always resolve as role=button across
    // Playwright versions; use the testid we added on the summary.
    await row.getByTestId("site-actions-summary").click();

    // Post-audit-3: archive now opens a ConfirmActionModal instead of
    // firing window.confirm(). Click the menu entry to open the modal,
    // then the modal's destructive confirm button.
    await row.getByTestId("site-archive-action").click();
    const confirmDialog = page.getByRole("dialog", { name: /archive/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: /^archive$/i }).click();

    // After router.refresh the row should be gone.
    await expect(row).toHaveCount(0);
  });
});
