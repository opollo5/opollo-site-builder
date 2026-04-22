import { expect, test } from "@playwright/test";

import { E2E_ADMIN_EMAIL } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

test.describe("users admin surface", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("/admin/users shows the seeded admin + invite modal opens", async ({
    page,
  }, testInfo) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await auditA11y(page, testInfo);

    // The seeded admin row is present. getByText would be a strict-mode
    // violation because the admin email also renders in the header
    // chrome's admin-user-email span. Scope the assertion to the users
    // table row instead.
    const selfRow = page.getByRole("row", {
      name: new RegExp(E2E_ADMIN_EMAIL),
    });
    await expect(selfRow).toBeVisible();

    // Invite button opens the modal (M2d-3 shipped the backend + UI).
    await page.getByRole("button", { name: /invite user/i }).click();
    await expect(
      page.getByRole("heading", { name: /invite user/i }),
    ).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  test("role dropdown is disabled for self (CANNOT_MODIFY_SELF guard)", async ({
    page,
  }) => {
    await page.goto("/admin/users");
    const selfRow = page.getByRole("row", {
      name: new RegExp(E2E_ADMIN_EMAIL),
    });
    const select = selfRow.getByRole("combobox");
    // The self row's <select> should be disabled per M2d-2's
    // UserRoleActionCell guard.
    await expect(select).toBeDisabled();
  });
});
