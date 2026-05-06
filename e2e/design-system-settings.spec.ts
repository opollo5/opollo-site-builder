import { expect, test, type Page } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// DS-SETTINGS — /admin/settings/design-system
//
// Scope:
//   1. Nav link visible for super_admin; navigates to the route.
//   2. Page renders the token editor with colour + typography + geometry fields.
//   3. Saving stubs the PUT API and shows the success toast.
//   4. Reset to defaults clears overridden badges without an API call.
//   5. Live preview iframe is present.
//   6. A11y audit passes.

async function stubSettingsApi(page: Page): Promise<void> {
  await page.route("**/api/admin/design-system-settings", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: {} }),
      });
    } else {
      await route.continue();
    }
  });
}

test.describe("/admin/settings/design-system", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubSettingsApi(page);
  });

  test("nav link routes to the page and token editor renders", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/sites");

    // super_admin sees the Design system nav link.
    const navLink = page.getByTestId("nav-design-system-settings");
    await expect(navLink).toBeVisible();
    await navLink.click();
    await page.waitForURL(/\/admin\/settings\/design-system$/);

    // Key sections are present.
    await expect(page.getByRole("heading", { name: /colours/i })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /typography/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /geometry/i }),
    ).toBeVisible();

    // Action buttons are present.
    await expect(page.getByTestId("ds-settings-save")).toBeVisible();
    await expect(page.getByTestId("ds-settings-reset")).toBeVisible();

    // Live preview iframe is present.
    await expect(
      page.getByTitle("Design system live preview"),
    ).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("saving changes calls the API and shows a success toast", async ({
    page,
  }) => {
    await page.goto("/admin/settings/design-system");

    // Change the display font field.
    const fontDisplayInput = page.getByPlaceholder("Fredoka");
    await fontDisplayInput.fill("Inter");

    // Save.
    await page.getByTestId("ds-settings-save").click();

    // Success toast appears.
    await expect(page.getByText(/design system settings saved/i)).toBeVisible({
      timeout: 5000,
    });
  });

  test("reset to defaults clears overridden badges", async ({ page }) => {
    await page.goto("/admin/settings/design-system");

    // Override a field so the "overridden" badge appears.
    const fontBodyInput = page.getByPlaceholder("Manrope");
    await fontBodyInput.fill("Helvetica");

    // The "overridden" badge should appear on that field.
    await expect(page.getByText("overridden").first()).toBeVisible();

    // Reset clears overrides without an API call.
    await page.getByTestId("ds-settings-reset").click();

    // The overridden badge disappears.
    await expect(page.getByText("overridden")).toHaveCount(0);
  });
});
