import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// Tests for the two-level navigation architecture.
//
// Primary nav must be visible on every authenticated page.
// Section nav must appear for sections that have sub-items (Social, Admin).
// Icon sizing must be consistent across all primary nav items.

const ADMIN_ROUTES = [
  "/admin/sites",
  "/admin/batches",
  "/admin/images",
];

const SOCIAL_ROUTES = [
  "/company/social/calendar",
  "/company/social/posts",
];

test.describe("Primary nav", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const route of ADMIN_ROUTES) {
    test(`primary nav visible on ${route}`, async ({ page }, testInfo) => {
      await page.goto(route);
      await expect(
        page.locator('[data-testid="primary-nav"]'),
      ).toBeVisible();
    });
  }

  test("primary nav contains Sites link", async ({ page }) => {
    await page.goto("/admin/sites");
    await expect(page.getByTestId("nav-sites")).toBeVisible();
  });

  test("primary nav contains Social link", async ({ page }) => {
    await page.goto("/admin/sites");
    await expect(page.getByTestId("nav-social")).toBeVisible();
  });

  test("Sites item is active on /admin/sites", async ({ page }) => {
    await page.goto("/admin/sites");
    const sitesItem = page.getByTestId("nav-sites");
    await expect(sitesItem).toHaveAttribute("aria-current", "page");
  });

  test("all primary nav icons have consistent size", async ({ page }) => {
    await page.goto("/admin/sites");
    const icons = await page.locator('[data-testid="primary-nav"] svg').all();
    expect(icons.length).toBeGreaterThan(0);
    const sizes = await Promise.all(
      icons.map(async (icon) => {
        const box = await icon.boundingBox();
        return box ? { w: Math.round(box.width), h: Math.round(box.height) } : null;
      }),
    );
    const validSizes = sizes.filter(Boolean);
    if (validSizes.length > 1) {
      // Allow for bottom-rail icons being slightly smaller (18px vs 22px)
      const widths = new Set(validSizes.map((s) => s!.w));
      expect(widths.size).toBeLessThanOrEqual(2);
    }
  });

  test("a11y on /admin/sites", async ({ page }, testInfo) => {
    await page.goto("/admin/sites");
    await auditA11y(page, testInfo);
  });
});

test.describe("Section nav", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("section nav does NOT appear on Sites (no sub-items)", async ({
    page,
  }) => {
    await page.goto("/admin/sites");
    // Section nav is absent when section has no sub-items
    await expect(page.locator('[data-testid="section-nav"]')).not.toBeVisible();
  });

  for (const route of SOCIAL_ROUTES) {
    test(`section nav shows "Social" on ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(
        page.locator('[data-testid="section-nav"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="section-nav-title"]'),
      ).toHaveText("Social");
    });
  }

  test("section nav collapse toggle hides the panel", async ({ page }) => {
    await page.goto("/company/social/posts");
    const sectionNav = page.locator('[data-testid="section-nav"]');
    await expect(sectionNav).toBeVisible();

    // Click collapse
    const collapseBtn = sectionNav.getByRole("button", {
      name: /collapse social navigation/i,
    });
    await collapseBtn.click();

    // Panel should collapse (collapse to 24px sliver; title no longer visible)
    await expect(
      page.locator('[data-testid="section-nav-title"]'),
    ).not.toBeVisible();

    // Click expand button to re-open
    const expandBtn = page.locator('[data-testid="section-nav"]').getByRole(
      "button",
      { name: /expand social navigation/i },
    );
    await expandBtn.click();
    await expect(
      page.locator('[data-testid="section-nav-title"]'),
    ).toBeVisible();
  });

  test("mobile nav button visible on small viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin/sites");
    await expect(page.getByTestId("mobile-nav-button")).toBeVisible();
  });

  test("mobile nav opens and shows nav items", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin/sites");
    await page.getByTestId("mobile-nav-button").click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer.getByRole("link", { name: "Sites" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Social" })).toBeVisible();
  });
});
