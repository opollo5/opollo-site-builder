import { test, expect } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: profile chip dimension regression (PR-A3)
//
// Verifies the 56px outer / 52px avatar / 24px brand-badge sizing restored
// after the platform badge was shipped at 20px (size=16 + p-0.5).
//
// Tests:
//  PC-1  Chip outer ≥ 55px wide
//  PC-2  Letter-fallback avatar span fills chip (≥ 50px wide)
//  PC-3  Platform badge ≥ 22px wide
//  PC-4  Selected state: aria-checked=true + ring class present
// ---------------------------------------------------------------------------

const MOCK_CONN = {
  id: "conn-sizing-li",
  platform: "linkedin",
  account_name: "Acme LinkedIn",
  account_avatar_url: null,
};

test.describe("profile chip dimensions (A3)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    // page.route() takes priority over context.route() — inject 1 LinkedIn connection
    await page.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [MOCK_CONN] } }),
      });
    });
    await page.goto("/company/social/calendar?compose=new");
    const dialog = page.getByRole("dialog", { name: /new post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
  });

  test("PC-1: chip outer width is at least 55px", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-sizing-li");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(55);
    expect(box!.height).toBeGreaterThanOrEqual(55);
  });

  test("PC-2: letter-fallback avatar fills the chip (≥ 50px)", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-sizing-li");
    await expect(chip).toBeVisible({ timeout: 10_000 });

    // Avatar is the first span child (absolute inset-0.5)
    const avatarWrap = chip.locator("span").first();
    const box = await avatarWrap.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(50);
  });

  test("PC-3: platform badge is at least 22px wide", async ({ page }) => {
    const badge = page.getByTestId("platform-badge-conn-sizing-li");
    await expect(badge).toBeVisible({ timeout: 10_000 });

    const box = await badge.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(22);
  });

  test("PC-4: clicking chip selects it (aria-checked=true)", async ({ page }) => {
    const chip = page.getByTestId("profile-chip-conn-sizing-li");
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toHaveAttribute("aria-checked", "false");

    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");
  });
});
