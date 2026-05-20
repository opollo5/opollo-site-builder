import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Spec: composer-v3 design system foundation — /design-system (dev only)
//
// Phase 1 of the social-composer-v3 rebuild:
//   - CSS custom properties under --c3-* namespace are present in the DOM
//   - Brand SVG icon components render with correct viewBox
//   - Typography specimens use Geist font via --c3-font-body
//   - Profile chip data-testid attributes are all present
//   - Page is notFound() in production (tested via env check in the page)
// ---------------------------------------------------------------------------

test.describe("/design-system (dev mode)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/design-system");
    await page.waitForSelector('[data-testid="c3-font-mono-sample"]', {
      timeout: 15_000,
    });
  });

  test("page renders and c3 CSS variables are applied", async ({ page }) => {
    // Canvas background uses --c3-canvas token
    const canvas = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--c3-canvas").trim()
    );
    expect(canvas).toBeTruthy();

    // Brand accent uses --c3-brand-500
    const brand = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--c3-brand-500").trim()
    );
    expect(brand).toBeTruthy();

    // Font variables are set
    const fontBody = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--c3-font-body").trim()
    );
    expect(fontBody).toBeTruthy();
  });

  test("Geist mono specimen is visible", async ({ page }) => {
    const mono = page.getByTestId("c3-font-mono-sample");
    await expect(mono).toBeVisible();
    const text = await mono.textContent();
    expect(text?.length).toBeGreaterThan(0);
  });

  test("all platform profile chips render", async ({ page }) => {
    const platforms = ["linkedin", "facebook", "instagram", "x", "gbp"];
    for (const p of platforms) {
      await expect(page.getByTestId(`c3-profile-chip-${p}`)).toBeVisible();
    }
  });

  test("brand SVG icons render for all eight platforms", async ({ page }) => {
    // Each brand icon is an <svg> inside the brand-icons section
    const svgCount = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="c3-brand-icons"]');
      return section ? section.querySelectorAll("svg").length : 0;
    });
    // 8 platform icons: LinkedIn, Facebook, Instagram, X, GBP, Pinterest, TikTok, YouTube
    expect(svgCount).toBeGreaterThanOrEqual(8);
  });

  test("motion tokens section renders", async ({ page }) => {
    const motionSection = page.getByTestId("c3-motion-tokens");
    await expect(motionSection).toBeVisible();
  });
});
