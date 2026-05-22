/**
 * Visual regression spec for the button consistency migration.
 *
 * Captures full-page screenshots of each audited surface and asserts
 * they match a committed baseline (stored in e2e/__screenshots__/).
 * Run once to create baselines, then re-run after each migration item
 * to catch unintended colour / layout regressions.
 *
 * NOTE: Runs against localhost (standard e2e stack). Auth via signInAsAdmin.
 * Surfaces that require company-admin session use signInAsCompanyAdmin.
 */

import { test, expect } from "@playwright/test";
import { signInAsAdmin, signInAsCompanyAdmin } from "../helpers";

test.describe.configure({ mode: "serial" });

// ── Admin surfaces (super_admin session) ─────────────────────────────────────

test.describe("admin surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("admin/sites", async ({ page }) => {
    await page.goto("/admin/sites");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("admin-sites.png", { fullPage: true });
  });

  test("admin/users", async ({ page }) => {
    await page.goto("/admin/users");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("admin-users.png", { fullPage: true });
  });

  test("admin/companies", async ({ page }) => {
    await page.goto("/admin/companies");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("admin-companies.png", { fullPage: true });
  });

  test("admin/health", async ({ page }) => {
    await page.goto("/admin/health");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("admin-health.png", { fullPage: true });
  });

  test("admin/errors", async ({ page }) => {
    await page.goto("/admin/errors");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("admin-errors.png", { fullPage: true });
  });

  test("admin/batches", async ({ page }) => {
    await page.goto("/admin/batches");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("admin-batches.png", { fullPage: true });
  });
});

// ── Auth surfaces (unauthenticated) ──────────────────────────────────────────

test.describe("auth surfaces", () => {
  test("login", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveScreenshot("auth-login.png", { fullPage: true });
  });

  test("forgot-password", async ({ page }) => {
    await page.goto("/auth/forgot-password");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveScreenshot("auth-forgot-password.png", { fullPage: true });
  });

  test("reset-password", async ({ page }) => {
    await page.goto("/auth/reset-password");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveScreenshot("auth-reset-password.png", { fullPage: true });
  });
});

// ── Company / social surfaces (company-admin session) ─────────────────────────

test.describe("social surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("social/calendar", async ({ page }) => {
    await page.goto("/company/social/calendar");
    await page.waitForLoadState("networkidle");
    // Don't open composer — just the calendar shell
    await expect(page).toHaveScreenshot("social-calendar.png", { fullPage: true });
  });

  test("social/posts", async ({ page }) => {
    await page.goto("/company/social/posts");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("social-posts.png", { fullPage: true });
  });

  test("social/connections", async ({ page }) => {
    await page.goto("/company/social/connections");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("social-connections.png", { fullPage: true });
  });

  test("social/media", async ({ page }) => {
    await page.goto("/company/social/media");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("social-media.png", { fullPage: true });
  });

  test("company/blog", async ({ page }) => {
    await page.goto("/company/blog");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("company-blog.png", { fullPage: true });
  });

  test("company/images", async ({ page }) => {
    await page.goto("/company/images");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("company-images.png", { fullPage: true });
  });

  test("company/users", async ({ page }) => {
    await page.goto("/company/users");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("company-users.png", { fullPage: true });
  });

  test("account/settings", async ({ page }) => {
    await page.goto("/account/settings");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("account-settings.png", { fullPage: true });
  });

  test("company/settings", async ({ page }) => {
    await page.goto("/company/settings");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("company-settings.png", { fullPage: true });
  });
});
