import { expect, test } from "@playwright/test";

import { E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

test.describe("auth happy path", () => {
  test("unauthenticated visit to /admin/sites redirects to /login", async ({
    page,
  }) => {
    await page.goto("/admin/sites");
    await page.waitForURL(/\/login/);
    await expect(page).toHaveURL(/\/login/);
  });

  test("sign in → admin landing → sign out", async ({ page }, testInfo) => {
    await page.goto("/login");
    await auditA11y(page, testInfo);

    await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
    await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(/\/admin\/sites/);
    await expect(page.getByRole("heading", { name: "Manage sites" })).toBeVisible();

    // Header shows the email + sign-out control.
    await expect(page.getByText(E2E_ADMIN_EMAIL)).toBeVisible();

    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
  });

  test("wrong password shows the generic invalid message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(
      page.getByText(/invalid email or password/i),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("signed-in admin reaches /admin/users", async ({ page }, testInfo) => {
    await signInAsAdmin(page);
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await auditA11y(page, testInfo);
  });
});
