import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// /admin/theming — super_admin theming dashboard e2e tests.
//
// Requires the global-setup super_admin session (signInAsAdmin).
// Tests that mutate theme rows clean up after themselves via Reset.
// Company selection uses the page default (first company) — no hardcoded IDs.
// ---------------------------------------------------------------------------

test.describe("/admin/theming", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("page loads and shows company selector", async ({ page }) => {
    await page.goto("/admin/theming");
    await expect(page.getByRole("heading", { name: "Theming" })).toBeVisible();
    await expect(page.locator("select")).toBeVisible();
  });

  test("token fields are present for all groups", async ({ page }) => {
    await page.goto("/admin/theming");
    await expect(page.locator("#token---primary")).toBeVisible();
    await expect(page.locator("#token---color-success-bg")).toBeVisible();
    await expect(page.locator("#token---color-success-fg")).toBeVisible();
    await expect(page.locator("#token---color-success-border")).toBeVisible();
    await expect(page.locator("#token---color-warning-bg")).toBeVisible();
    await expect(page.locator("#token---color-danger-bg")).toBeVisible();
    await expect(page.locator("#token---radius")).toBeVisible();
  });

  test("save and reset round-trip", async ({ page }) => {
    // Navigate to page; let it default to the first available company.
    await page.goto("/admin/theming");
    await expect(page.getByRole("heading", { name: "Theming" })).toBeVisible();

    const bgInput = page.locator("#token---color-success-bg");
    await bgInput.clear();
    await bgInput.fill("#ABCDEF");

    await page.getByRole("button", { name: /save theme/i }).click();
    await expect(page.locator("text=Theme saved")).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await signInAsAdmin(page);
    await page.goto("/admin/theming");
    await expect(page.locator("#token---color-success-bg")).toHaveValue("#ABCDEF");

    // Clean up: reset to defaults.
    await page.getByRole("button", { name: /reset to defaults/i }).click();
    await expect(page.locator("text=Reset to defaults")).toBeVisible({ timeout: 10_000 });
  });

  test("WCAG contrast warning shown when bg/fg contrast is below 4.5:1", async ({ page }) => {
    await page.goto("/admin/theming");
    await expect(page.getByRole("heading", { name: "Theming" })).toBeVisible();

    // Set success bg and fg to nearly identical white values — very low contrast.
    await page.locator("#token---color-success-bg").fill("#ffffff");
    await page.locator("#token---color-success-fg").fill("#eeeeee");

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
