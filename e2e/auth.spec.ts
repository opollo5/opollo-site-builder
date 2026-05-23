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
    await expect(page.getByRole("heading", { name: "Sites", level: 1 })).toBeVisible();

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
    await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
    await auditA11y(page, testInfo);
  });
});

// ---------------------------------------------------------------------------
// Incident 20.6 regression — 2FA challenge flow reaches /login/check-email
//
// Requires AUTH_2FA_ENABLED=true in the e2e environment and a seeded admin
// user with no pre-existing trusted device entry. Email approval must be
// interceptable (e.g., via a test SMTP sink or the /api/auth/approve route
// accessible to the e2e user). Mark fixme until the e2e seed includes a
// dedicated 2FA test user and the environment exposes a way to intercept
// the approval token without real email delivery.
// ---------------------------------------------------------------------------

test.describe("2FA challenge flow (Incident 20.6 regression)", () => {
  test.fixme(
    "credential submit → /login/check-email renders (not blank/logout)",
    async ({ page }) => {
      // Pre-conditions:
      //   AUTH_2FA_ENABLED=true in the test environment
      //   The seeded admin user has no trusted_devices row
      //   A way to retrieve the raw_token (test SMTP sink or DB read)
      //
      // Flow:
      //   1. POST /login with valid credentials
      //   2. Browser navigates to /login/check-email (not /logout)
      //   3. Page shows "Check your email" UI
      //   4. Retrieve approval token from test sink
      //   5. Visit /auth/approve?token=<raw_token>
      //   6. CheckEmailPolling detects approved status
      //   7. Complete-login fires → window.location.assign → /admin/sites
      await page.goto("/login");
      await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
      await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();
      await page.waitForURL(/\/login\/check-email/);
      await expect(page.getByText(/check your email/i)).toBeVisible();
    },
  );
});
