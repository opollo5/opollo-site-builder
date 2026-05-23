import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// /admin/theming — super_admin theming dashboard e2e tests.
//
// These tests run against the live dev/test environment (NEXT_PUBLIC_SUPABASE_URL
// must point to a seeded instance). They test page load, company selector,
// save round-trip, and reset.
//
// The suite relies on the global auth fixture (global-setup.ts) which seeds
// a super_admin session. Tests that mutate theme rows clean up after themselves.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

test.describe("/admin/theming", () => {
  test("page loads and shows company selector", async ({ page }) => {
    await page.goto("/admin/theming");
    await expect(page.getByRole("heading", { name: "Theming" })).toBeVisible();
    await expect(page.locator("select")).toBeVisible();
  });

  test("token fields are present for all groups", async ({ page }) => {
    await page.goto("/admin/theming");
    // Brand
    await expect(page.locator("#token---primary")).toBeVisible();
    // Success group
    await expect(page.locator("#token---color-success-bg")).toBeVisible();
    await expect(page.locator("#token---color-success-fg")).toBeVisible();
    await expect(page.locator("#token---color-success-border")).toBeVisible();
    // Warning group
    await expect(page.locator("#token---color-warning-bg")).toBeVisible();
    // Danger group
    await expect(page.locator("#token---color-danger-bg")).toBeVisible();
    // Radius
    await expect(page.locator("#token---radius")).toBeVisible();
  });

  test("save and reset round-trip", async ({ page }) => {
    await page.goto(`/admin/theming?company=${COMPANY_ID}`);

    // Set a distinctive success-bg value.
    const bgInput = page.locator("#token---color-success-bg");
    await bgInput.clear();
    await bgInput.fill("#ABCDEF");

    // Save.
    await page.getByRole("button", { name: /save theme/i }).click();
    await expect(page.locator("text=Theme saved")).toBeVisible({ timeout: 10_000 });

    // Verify the value persists after reload.
    await page.reload();
    await expect(page.locator("#token---color-success-bg")).toHaveValue("#ABCDEF");

    // Reset to defaults.
    await page.getByRole("button", { name: /reset to defaults/i }).click();
    await expect(page.locator("text=Reset to defaults")).toBeVisible({ timeout: 10_000 });

    // Field should be empty after reset.
    await page.reload();
    await expect(page.locator("#token---color-success-bg")).toHaveValue("");
  });

  test("WCAG contrast warning shown when bg/fg contrast is below 4.5:1", async ({ page }) => {
    await page.goto(`/admin/theming?company=${COMPANY_ID}`);

    // Set bg and fg to very similar colours — low contrast.
    await page.locator("#token---color-success-bg").fill("#ffffff");
    await page.locator("#token---color-success-fg").fill("#eeeeee");

    // Warning should appear.
    await expect(
      page.locator("text=/contrast ratio.*below 4.5:1/i"),
    ).toBeVisible();
  });

  test("preview section shows sample button and status banner", async ({ page }) => {
    await page.goto("/admin/theming");
    await expect(page.getByRole("button", { name: "Primary action" })).toBeVisible();
    await expect(page.locator("text=Connected — your integration is working")).toBeVisible();
  });
});
