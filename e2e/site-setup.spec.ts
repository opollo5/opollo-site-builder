import { expect, test, type Page } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// DESIGN-DISCOVERY PR 3 — wizard shell happy path.
//
// Drives /admin/sites/[id]/setup end-to-end:
//   1. Land on Step 1 (resume logic; fresh site = step 1 since both
//      status columns default to 'pending').
//   2. Skip Step 1 → Step 2.
//   3. Skip Step 2 → Step 3 (Done).
//   4. Step 3 reflects "Using defaults" copy and the "Start generating
//      content" CTA returns to /admin/sites/[id].
//
// Subsequent PRs add the real input surface inside each step; this
// spec only covers the shell + skip + resume.

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

async function createSiteAndOpenSetup(
  page: Page,
  name: string,
): Promise<string> {
  await page.goto("/admin/sites/new");
  await page.getByTestId("site-name").fill(name);
  await page.getByTestId("site-wp-url").fill("https://setup-wizard.test");
  await page.getByTestId("site-wp-user").fill("wp");
  await page.getByTestId("site-wp-password").fill("password-1234");
  await page.getByTestId("site-test-connection").click();
  await expect(page.getByTestId("site-test-result")).toContainText(
    /Connected as/i,
  );
  await page.getByTestId("site-create-save").click();
  // DESIGN-SYSTEM-OVERHAUL (PR 6) — fresh sites land on the
  // /onboarding mode-selection screen first. Pick "Build a new
  // website" to continue into the existing design-discovery wizard
  // at step 1.
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/onboarding/);
  const url = page.url();
  const id = url.match(/\/admin\/sites\/([0-9a-f-]{36})/)?.[1];
  if (!id) throw new Error(`Failed to extract site id from ${url}`);
  await page.getByTestId("site-onboarding-option-new_design").click();
  await page.getByTestId("site-onboarding-submit").click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/setup\?step=1/);
  return id;
}

test.describe("setup wizard shell", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubTestConnection(page);
  });

  test("fresh site lands on step 1; skip → step 2 → step 3 done with defaults", async ({
    page,
  }, testInfo) => {
    const name = `Setup Wizard ${Date.now()}`;
    const id = await createSiteAndOpenSetup(page, name);

    // Resume redirect on no ?step → step 1.
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=1`),
    );
    await expect(page.getByTestId("setup-step-1")).toBeVisible();
    await auditA11y(page, testInfo);

    // Skip Step 1 → land on Step 2.
    await page.getByTestId("setup-step-1-skip").click();
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=2`),
    );
    await expect(page.getByTestId("setup-step-2")).toBeVisible();
    await auditA11y(page, testInfo);

    // Skip Step 2 → Step 3 done screen.
    await page.getByTestId("setup-step-2-skip").click();
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=3`),
    );
    await expect(page.getByTestId("setup-step-3")).toBeVisible();
    await expect(
      page.getByText(
        /You're using default styles\. Set these up any time from Site Settings\./i,
      ),
    ).toBeVisible();
    await auditA11y(page, testInfo);

    // Finish CTA returns to the site detail page.
    await page.getByTestId("setup-step-3-finish").click();
    await page.waitForURL(new RegExp(`/admin/sites/${id}$`));
    await expect(page.getByRole("heading", { name })).toBeVisible();
  });

  test("returning to setup with both steps skipped resumes at step 3", async ({
    page,
  }) => {
    const name = `Setup Resume ${Date.now()}`;
    const id = await createSiteAndOpenSetup(page, name);
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=1`),
    );
    await page.getByTestId("setup-step-1-skip").click();
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=2`),
    );
    await page.getByTestId("setup-step-2-skip").click();
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=3`),
    );

    // Re-enter the wizard without ?step — resume should land on 3.
    await page.goto(`/admin/sites/${id}/setup`);
    await page.waitForURL(
      new RegExp(`/admin/sites/${id}/setup\\?step=3`),
    );
    await expect(page.getByTestId("setup-step-3")).toBeVisible();
  });
});
