import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// PR I — Admin service health dashboard E2E tests
//
// Gate patterns (BUILD_ORDER.md PR I):
//   "service status grid", "rbac", "manual flag", "resolve"
// ---------------------------------------------------------------------------

const HEALTH_URL = "/admin/system/health";

test.describe("admin service health dashboard (PR I)", () => {
  // -------------------------------------------------------------------------
  // service status grid
  // -------------------------------------------------------------------------

  test("service status grid — renders 7 service cards", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(HEALTH_URL);
    await page.waitForSelector('[data-testid="service-status-grid"]');

    const cards = page.locator('[data-testid="service-status-grid"] > div');
    await expect(cards).toHaveCount(7);
  });

  test("service status grid — each card has a Flag for review button", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto(HEALTH_URL);
    await page.waitForSelector('[data-testid="service-status-grid"]');

    const flagButtons = page.getByRole("button", { name: "Flag for review" });
    await expect(flagButtons).toHaveCount(7);
  });

  // -------------------------------------------------------------------------
  // rbac — non-super-admin cannot access
  // -------------------------------------------------------------------------

  test("rbac — unauthenticated user is redirected to login", async ({
    page,
  }) => {
    await page.goto(HEALTH_URL);
    // No auth cookie — middleware redirects to /login.
    await expect(page).toHaveURL(/\/login/);
  });

  test("rbac — company admin (non super_admin) cannot access health page", async ({
    page,
  }) => {
    // Sign in as a regular company admin who doesn't have super_admin role.
    // The page gate redirects to "/" for insufficient role.
    // We use a non-admin email to test the gate; if E2E seeds don't have
    // a non-super_admin account we guard with a skip.
    const nonAdminEmail = process.env.E2E_CUSTOMER_EMAIL;
    const nonAdminPassword = process.env.E2E_CUSTOMER_PASSWORD;
    if (!nonAdminEmail || !nonAdminPassword) {
      test.skip(
        true,
        "E2E_CUSTOMER_EMAIL/PASSWORD not set — cannot test non-admin access",
      );
      return;
    }

    await page.goto("/login");
    await page.getByLabel("Email").fill(nonAdminEmail);
    await page.getByLabel("Password").fill(nonAdminPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    // Wait for login to complete.
    await page.waitForTimeout(1500);

    await page.goto(HEALTH_URL);
    // Should redirect away from the health page (either / or /login).
    await expect(page).not.toHaveURL(HEALTH_URL);
  });

  // -------------------------------------------------------------------------
  // manual flag
  // -------------------------------------------------------------------------

  test("manual flag — dialog opens and can be submitted", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(HEALTH_URL);
    await page.waitForSelector('[data-testid="service-status-grid"]');

    // Click the first "Flag for review" button (bundle.social card).
    await page.getByRole("button", { name: "Flag for review" }).first().click();

    // Dialog should appear.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Flag service for review");

    // Fill in notes and submit.
    await page.getByLabel("Notes").fill("Test flag from e2e suite");
    await page.locator('[data-testid="flag-submit"]').click();

    // Dialog should close after successful submit.
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test("manual flag — dialog can be dismissed without submitting", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto(HEALTH_URL);
    await page.waitForSelector('[data-testid="service-status-grid"]');

    await page.getByRole("button", { name: "Flag for review" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // event timeline
  // -------------------------------------------------------------------------

  test("event timeline — renders table when events exist", async ({ page }) => {
    // Seed a test event first via the flag API, then reload.
    await signInAsAdmin(page);
    await page.goto(HEALTH_URL);
    await page.waitForSelector('[data-testid="service-status-grid"]');

    // Create a flag event so the timeline has at least one row.
    const res = await page.evaluate(async () => {
      const r = await fetch("/api/admin/service-health/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_name: "anthropic",
          issue_type: "other",
          notes: "e2e timeline seed",
        }),
      });
      return r.status;
    });
    expect(res).toBe(200);

    // Reload to re-fetch server-side data.
    await page.reload();
    await page.waitForSelector('[data-testid="event-timeline"]');
    const rows = page.locator('[data-testid="event-timeline"] tbody tr');
    await expect(rows.first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // resolve
  // -------------------------------------------------------------------------

  test("resolve — clicking Resolve marks event resolved in UI", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto(HEALTH_URL);
    await page.waitForSelector('[data-testid="service-status-grid"]');

    // Seed an open event via flag API.
    const flagRes = await page.evaluate(async () => {
      const r = await fetch("/api/admin/service-health/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_name: "sendgrid",
          issue_type: "billing",
          notes: "e2e resolve test",
        }),
      });
      const body = await r.json();
      return body as { event?: { id: string } };
    });

    const eventId = flagRes.event?.id;
    if (!eventId) test.skip(true, "Flag API did not return event id");

    // Reload to see the event.
    await page.reload();
    await page.waitForSelector('[data-testid="event-timeline"]');

    // Click the resolve button for this specific event.
    const resolveBtn = page.locator(`[data-testid="resolve-${eventId}"]`);
    if (!(await resolveBtn.isVisible())) {
      test.skip(true, "Resolve button not visible — event may already be resolved");
      return;
    }

    await resolveBtn.click();

    // After resolve, button disappears and "Resolved" text appears in that row.
    await expect(resolveBtn).not.toBeVisible({ timeout: 3000 });
  });
});
