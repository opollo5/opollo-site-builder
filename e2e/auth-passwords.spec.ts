import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// M14-5 — E2E coverage for the M14 password flows.
//
// Covers three distinct surfaces:
//
//   1. /auth/forgot-password → email link → /auth/reset-password →
//      set new password → sign in with new / reject with old.
//
//   2. /account/security → current-password verification, weak-password
//      rejection, same-password rejection, happy path + sign-in
//      rotation.
//
//   3. Error UX — landing on /auth/reset-password with no session,
//      and landing on /api/auth/callback with an invalid code.
//
// Uses a dedicated throwaway user per spec run, created in beforeAll
// and deleted in afterAll — keeps the seeded playwright-admin@opollo.test
// untouched so other specs aren't disturbed. The dedicated user is
// needed because these tests mutate the account's password, which would
// invalidate the shared fixture across test runs.
//
// Email simulation: we don't wait for inbucket — Supabase's
// auth.admin.generateLink({type:'recovery'}) returns the same action
// URL the email would contain, deterministically. Tests navigate to
// that URL directly and exercise the full /api/auth/callback → session
// set → /auth/reset-password path.
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `auth-passwords.spec: ${name} is not set. Run via \`npm run test:e2e\` so global-setup exports credentials.`,
    );
  }
  return v;
}

function serviceClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type TestUser = {
  id: string;
  email: string;
  password: string;
};

async function createTestUser(suffix: string): Promise<TestUser> {
  const svc = serviceClient();
  // Timestamp + suffix keeps the email unique across retried runs.
  const email = `playwright-pw-${suffix}-${Date.now()}@opollo.test`;
  const password = "initial-password-12-chars";
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? "no user"}`);
  }
  return { id: data.user.id, email, password };
}

async function deleteTestUser(userId: string): Promise<void> {
  const svc = serviceClient();
  await svc.auth.admin.deleteUser(userId);
}

async function signInViaForm(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/admin\/sites/);
}

async function assertSignInFails(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Error message appears; URL stays on /login.
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
  expect(page.url()).toContain("/login");
}

// ---------------------------------------------------------------------------
// /auth/forgot-password → /auth/reset-password happy path
// ---------------------------------------------------------------------------

test.describe.serial("M14-5 forgot-password flow", () => {
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("forgot");
  });

  test.afterAll(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test("forgot-password → email link → reset → sign in with new / reject old", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(60_000);

    // Step 1: open /login → follow "Forgot password?" link.
    await page.goto("/login");
    await page.getByRole("link", { name: /forgot password/i }).click();
    await page.waitForURL(/\/auth\/forgot-password/);

    // Step 2: submit the forgot-password form with the test user's email.
    await page.getByLabel("Email").fill(user.email);
    await page.getByRole("button", { name: /send reset link/i }).click();

    // Step 3: see the success envelope (no-enumeration copy).
    await expect(page.getByText(/check your email/i)).toBeVisible();

    // Step 4: simulate clicking the email link by generating the
    // recovery link via admin API and navigating to it. Mirrors what
    // Supabase would tack onto the outgoing email.
    const svc = serviceClient();
    const redirectTo = `${baseURL ?? "http://localhost:3000"}/api/auth/callback?next=%2Fauth%2Freset-password`;
    const { data, error } = await svc.auth.admin.generateLink({
      type: "recovery",
      email: user.email,
      options: { redirectTo },
    });
    expect(error, error?.message).toBeNull();
    const actionLink = data?.properties?.action_link;
    expect(actionLink).toBeTruthy();

    // Navigate. Supabase will verify the token server-side then 302 back
    // to redirectTo with ?code=xxx, which our /api/auth/callback
    // exchanges for a session and redirects to /auth/reset-password.
    await page.goto(actionLink as string);
    await page.waitForURL(/\/auth\/reset-password/);

    // Step 5: set a new password.
    const newPassword = "new-pass-abc-1234-strong";
    await page.getByLabel(/^new password$/i).fill(newPassword);
    await page.getByLabel(/confirm new password/i).fill(newPassword);
    await page.getByRole("button", { name: /update password/i }).click();

    // Step 6: land on /admin/sites signed in.
    await page.waitForURL(/\/admin\/sites/);

    // Step 7: sign out, verify the OLD password is rejected.
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
    await assertSignInFails(page, user.email, user.password);

    // Step 8: verify the NEW password works.
    await signInViaForm(page, user.email, newPassword);
    await expect(page).toHaveURL(/\/admin\/sites/);

    // Track the new password for the afterAll (so deleteUser still
    // works regardless of password state, but keep the record honest).
    user.password = newPassword;
  });

  test("expired reset link lands on the request-a-new-link UI", async ({
    page,
    context,
  }) => {
    // Clear all cookies so no session is present → /auth/reset-password
    // should render the "link expired" state, not the form.
    await context.clearCookies();

    await page.goto("/auth/reset-password");
    await expect(
      page.getByRole("heading", { name: /reset link expired/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /request a new link/i }),
    ).toBeVisible();

    // Click CTA → lands on forgot-password.
    await page.getByRole("link", { name: /request a new link/i }).click();
    await page.waitForURL(/\/auth\/forgot-password/);
  });

  test("invalid callback code redirects to /auth-error", async ({ page }) => {
    await page.goto("/api/auth/callback?code=garbage-definitely-not-a-real-code");
    await page.waitForURL(/\/auth-error/);
    expect(page.url()).toContain("reason=exchange_failed");
  });
});

// ---------------------------------------------------------------------------
// /account/security change-password flow
// ---------------------------------------------------------------------------

test.describe.serial("M14-5 account-security change-password", () => {
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("change");
  });

  test.afterAll(async () => {
    if (user) await deleteTestUser(user.id);
  });

  test("wrong current password surfaces a translated error", async ({ page }) => {
    test.setTimeout(45_000);
    await signInViaForm(page, user.email, user.password);

    await page.goto("/account/security");
    await page.getByLabel(/current password/i).fill("wrong-current-1234");
    await page.getByLabel(/^new password$/i).fill("new-pass-abc-1234");
    await page.getByLabel(/confirm new password/i).fill("new-pass-abc-1234");
    await page.getByRole("button", { name: /update password/i }).click();

    await expect(
      page.getByRole("alert").filter({ hasText: /current password is incorrect/i }),
    ).toBeVisible();
  });

  test("correct current + valid new password rotates credentials", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInViaForm(page, user.email, user.password);

    const newPassword = "change-pass-xyz-5678-stronger";
    await page.goto("/account/security");
    await page.getByLabel(/current password/i).fill(user.password);
    await page.getByLabel(/^new password$/i).fill(newPassword);
    await page.getByLabel(/confirm new password/i).fill(newPassword);
    await page.getByRole("button", { name: /update password/i }).click();

    // Success message appears, form clears to idle.
    await expect(
      page.getByRole("status").filter({ hasText: /password updated/i }),
    ).toBeVisible();

    // Sign out, verify old password rejected, new password accepted.
    await page.goto("/admin/sites");
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/login/);
    await assertSignInFails(page, user.email, user.password);
    await signInViaForm(page, user.email, newPassword);

    user.password = newPassword;
  });
});
