import { expect, test } from "@playwright/test";

import { auditA11y, signInAsCompanyAdmin } from "./helpers";

// P-Brand-1d — customer brand profile happy path.
//
// Scope:
//   1. Landing page shows tier-none completion banner for a fresh company.
//   2. "Get started" link navigates to /company/settings/brand.
//   3. Brand editor form renders (no existing profile → "Create profile" CTA).
//   4. Filling fields and submitting creates the profile ("Brand profile created.").
//   5. Reload confirms values are persisted.
//   6. Landing page no longer shows the completion banner after a non-none tier.
//   7. auditA11y on each visited page.
//
// The PATCH call hits the real local Supabase via the Next.js API route.
// No external calls are made (image gen, bundle.social are not exercised here).

test.describe("customer / brand profile", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("landing banner → brand form create → persist → banner gone", async ({
    page,
  }, testInfo) => {
    // ── 1. Landing page ──────────────────────────────────────────────────────
    await page.goto("/company");
    await expect(page).toHaveURL(/\/company/);
    await auditA11y(page, testInfo);

    // Brand completion banner visible (tier=none — no profile seeded yet).
    const banner = page.getByTestId("brand-completion-banner");
    await expect(banner).toBeVisible();

    // ── 2. Navigate to brand form ────────────────────────────────────────────
    await page.getByTestId("brand-completion-cta").click();
    await page.waitForURL(/\/company\/settings\/brand/);
    await auditA11y(page, testInfo);

    // Submit button says "Create profile" for a brand-less company.
    const submitBtn = page.getByTestId("brand-editor-submit");
    await expect(submitBtn).toHaveText("Create profile");

    // ── 3. Fill form ─────────────────────────────────────────────────────────
    // Primary colour is enough to hit the "minimal" tier on save.
    await page.locator("#primary_colour").fill("#1A2B3C");
    await page.locator("#industry").fill("Technology / SaaS");

    // ── 4. Submit ────────────────────────────────────────────────────────────
    await submitBtn.click();

    const successMsg = page.getByTestId("brand-editor-success");
    await expect(successMsg).toBeVisible({ timeout: 10_000 });
    await expect(successMsg).toContainText("Brand profile created.");

    // No error banner.
    await expect(page.getByTestId("brand-editor-error")).not.toBeVisible();

    // ── 5. Reload — values persisted ─────────────────────────────────────────
    await page.reload();
    await expect(page.locator("#primary_colour")).toHaveValue("#1A2B3C");
    await expect(page.locator("#industry")).toHaveValue("Technology / SaaS");

    // Submit button now says "Save changes" (profile exists).
    await expect(page.getByTestId("brand-editor-submit")).toHaveText(
      "Save changes",
    );

    // ── 6. Landing — banner gone ──────────────────────────────────────────────
    await page.goto("/company");
    await expect(
      page.getByTestId("brand-completion-banner"),
    ).not.toBeVisible();

    await auditA11y(page, testInfo);
  });
});
