import { test, expect } from "@playwright/test";
import {
  signInAsUatBot,
  UAT_BASE_URL,
  UAT_EMAIL,
} from "./helpers/auth";
import { collectConsole, saveFailureReport } from "./helpers/report";

// ---------------------------------------------------------------------------
// P0 — Auth & session
// Tests that the UAT ghost user can sign in, that the session persists
// across navigation, and that sign-out + protected-route guards work.
// ---------------------------------------------------------------------------

test.describe("P0 — Auth & session", () => {
  let consoleMessages: string[];

  test.beforeEach(async ({ page }) => {
    consoleMessages = collectConsole(page);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await saveFailureReport(page, testInfo, { consoleMessages });
  });

  test("signInAsUatBot succeeds and lands on /company/social", async ({
    page,
  }) => {
    const session = await signInAsUatBot(page);

    // Verify session shape
    expect(session.access_token).toBeTruthy();
    expect(session.refresh_token).toBeTruthy();
    expect(session.user.email).toBe(UAT_EMAIL);

    await page.screenshot({ path: "test-results/uat/auth/sign-in-session.png" });

    // Navigate to the social surface and assert we are authenticated
    await page.goto(`${UAT_BASE_URL}/company/social/calendar`);
    await page.screenshot({ path: "test-results/uat/auth/sign-in-landing.png" });

    // Must NOT be on the login page
    expect(page.url()).not.toContain("/login");
    // Must be on the social calendar (authenticated redirect)
    await expect(page).toHaveURL(/\/company\/social/);
  });

  test("sign-out works — navigating to protected route redirects to /login", async ({
    page,
  }) => {
    await signInAsUatBot(page);
    await page.goto(`${UAT_BASE_URL}/company/social/calendar`);
    await expect(page).toHaveURL(/\/company\/social/);

    await page.screenshot({ path: "test-results/uat/auth/before-sign-out.png" });

    // Click sign-out
    const signOutBtn = page.locator('[data-testid="nav-sign-out"]').first();
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.click();

    // After sign-out, should redirect to /login
    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await page.screenshot({ path: "test-results/uat/auth/after-sign-out.png" });
    expect(page.url()).toContain("/login");
  });

  test("protected route while signed out redirects to /login", async ({
    page,
  }) => {
    // No sign-in — attempt direct navigation to protected route
    await page.goto(`${UAT_BASE_URL}/company/social/calendar`);
    await page.screenshot({ path: "test-results/uat/auth/unauthenticated-redirect.png" });

    // Should redirect to /login with ?next= param
    await expect(page).toHaveURL(/\/login/);
  });
});
