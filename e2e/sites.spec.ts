import { expect, test, type Page } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// AUTH-FOUNDATION P2.2 — sites CRUD now flows through /admin/sites/new
// (single-page guided form) instead of the old AddSiteModal. The
// Test-connection button is gated on a live POST to a third-party WP
// install, which obviously isn't reachable from CI; we stub the
// /api/sites/test-connection response so the form can pass its gate
// and exercise the rest of the create flow.

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

async function createSiteViaForm(
  page: Page,
  fields: { name: string; url: string; user: string; password: string },
): Promise<void> {
  await page.goto("/admin/sites/new");
  await page.getByTestId("site-name").fill(fields.name);
  await page.getByTestId("site-wp-url").fill(fields.url);
  await page.getByTestId("site-wp-user").fill(fields.user);
  await page.getByTestId("site-wp-password").fill(fields.password);

  // Save must be disabled until the test passes.
  await expect(page.getByTestId("site-create-save")).toBeDisabled();

  await page.getByTestId("site-test-connection").click();
  await expect(page.getByTestId("site-test-result")).toContainText(
    /Connected as/i,
  );

  await expect(page.getByTestId("site-create-save")).toBeEnabled();
  await page.getByTestId("site-create-save").click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
}

test.describe("sites CRUD", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubTestConnection(page);
  });

  test("sites list renders + row click lands on detail", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/sites");
    await auditA11y(page, testInfo);
    await expect(page.getByRole("heading", { name: /^Sites$/i })).toBeVisible();

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

  test("add site — guided form gates save on a passing connection test", async ({
    page,
  }, testInfo) => {
    const uniqueName = `Playwright Temp ${Date.now()}`;
    await createSiteViaForm(page, {
      name: uniqueName,
      url: "https://temp.test",
      user: "wp-user",
      password: "abcd efgh ijkl mnop qrst uvwx",
    });

    // Detail page renders the new site name.
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

    // Going back to the list shows the new row.
    await page.goto("/admin/sites");
    await expect(page.getByText(uniqueName).first()).toBeVisible();
    await auditA11y(page, testInfo);
  });

  test("editing a credential after a passing test invalidates Save", async ({
    page,
  }) => {
    await page.goto("/admin/sites/new");
    await page.getByTestId("site-name").fill(`Invalidate ${Date.now()}`);
    await page.getByTestId("site-wp-url").fill("https://invalidate.test");
    await page.getByTestId("site-wp-user").fill("wp");
    await page.getByTestId("site-wp-password").fill("password-1234");
    await page.getByTestId("site-test-connection").click();
    await expect(page.getByTestId("site-create-save")).toBeEnabled();

    // Edit the password — Save should disable + the result panel
    // should flip to the "credentials changed" tone.
    await page.getByTestId("site-wp-password").fill("password-different");
    await expect(page.getByTestId("site-create-save")).toBeDisabled();
  });

  test("edit page rotates the WordPress username via the unified form", async ({
    page,
  }) => {
    const seedName = `Edit Target ${Date.now()}`;
    await createSiteViaForm(page, {
      name: seedName,
      url: "https://edit-me.test",
      user: "wp-old",
      password: "password-1234",
    });

    // Navigate via the URL — the actions-menu Edit button on the
    // sites list lands on the same route.
    const detailUrl = page.url();
    const editUrl = `${detailUrl}/edit`;
    await page.goto(editUrl);

    // Form pre-seeds with the existing values.
    await expect(page.getByTestId("site-name")).toHaveValue(seedName);
    await expect(page.getByTestId("site-wp-user")).toHaveValue("wp-old");
    // Password renders the placeholder, value stays empty.
    await expect(page.getByTestId("site-wp-password")).toHaveValue("");
    await expect(page.getByTestId("site-wp-password")).toHaveAttribute(
      "placeholder",
      /unchanged/i,
    );

    // Editing only the name doesn't require a connection test.
    await page.getByTestId("site-name").fill(`${seedName} (renamed)`);
    await expect(page.getByTestId("site-edit-save")).toBeEnabled();

    // Now rotate the username — that touches the credential set, so
    // Save should disable until a passing test for the new key.
    await page.getByTestId("site-wp-user").fill("wp-new");
    await page.getByTestId("site-wp-password").fill("rotated-password");
    await expect(page.getByTestId("site-edit-save")).toBeDisabled();

    await page.getByTestId("site-test-connection").click();
    await expect(page.getByTestId("site-test-result")).toContainText(
      /Connected as/i,
    );
    await expect(page.getByTestId("site-edit-save")).toBeEnabled();

    await page.getByTestId("site-edit-save").click();
    // Lands back on the detail page after save.
    await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: `${seedName} (renamed)` }),
    ).toBeVisible();
  });

  test("archive flow removes the site from the default list", async ({
    page,
  }) => {
    const disposableName = `Archive Target ${Date.now()}`;
    await createSiteViaForm(page, {
      name: disposableName,
      url: "https://archive-me.test",
      user: "wp",
      password: "password-1234",
    });

    await page.goto("/admin/sites");
    const row = page.getByRole("row", { name: new RegExp(disposableName) });
    await expect(row).toBeVisible();

    await row.getByTestId("site-actions-summary").click();
    await row.getByTestId("site-archive-action").click();
    const confirmDialog = page.getByRole("dialog", { name: /archive/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: /^archive$/i }).click();

    await expect(row).toHaveCount(0);
  });
});
