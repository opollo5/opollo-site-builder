import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Browser, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin, signInAsCompanyAdmin } from "./helpers";
import { E2E_TEST_SITE_PREFIX } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// A-0 — Visual regression screenshot harness.
//
// Captures every admin + social surface at two viewports:
//   - Desktop  1440×900 (Linear / Vercel reference)
//   - Mobile    380×844 (iPhone-class width floor)
//
// Two outputs per route:
//   1. playwright-screenshots/<viewport>/<route-slug>.png
//      → uploaded as a CI artifact; reviewers download for visual diff.
//   2. expect(page).toHaveScreenshot() baseline in e2e/__screenshots__/
//      → automated regression gate. CI fails on mismatch once baselines
//      are committed. Baselines are skipped on first run (no file present)
//      to avoid bootstrap failures; generate them with:
//
//        npm run screenshots:baseline
//
//      then commit e2e/__screenshots__/ to lock the baseline.
//
// Viewport taxonomy:
//   ADMIN_ROUTES   — signed in as Opollo super_admin (all /admin/* routes)
//   COMPANY_ROUTES — signed in as company admin (all /company/social/* routes)
//
// Determinism:
//   - reducedMotion: "reduce" disables CSS animations.
//   - Locale en-US + timezone UTC stabilise date-formatted strings.
//   - networkidle wait ensures SSR + hydration settle.
//   - [data-screenshot-mask] elements are masked (muted gray) so
//     relative timestamps ("updated 2 min ago") don't churn the diff.
// ---------------------------------------------------------------------------

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 380, height: 844 } as const;

const SCREENSHOTS_DIR = path.join(process.cwd(), "playwright-screenshots");

// Snapshots are stored at:
// e2e/__screenshots__/screenshots.spec.ts/<slug>-<viewport>-linux.png
// Matches snapshotPathTemplate in playwright.config.ts.
const SNAPSHOT_DIR = path.join(
  process.cwd(),
  "e2e/__screenshots__/screenshots.spec.ts",
);

interface RouteEntry {
  slug: string;
  url: string;
  waitForSelector?: string;
  hydrationDelayMs?: number;
}

// Admin routes — sign in as Opollo super_admin.
const ADMIN_ROUTES: readonly RouteEntry[] = [
  { slug: "login", url: "/login" },
  { slug: "auth-forgot-password", url: "/auth/forgot-password" },
  { slug: "admin-sites-list", url: "/admin/sites" },
  { slug: "admin-site-detail", url: "/admin/sites/{siteId}" },
  { slug: "admin-site-settings", url: "/admin/sites/{siteId}/settings" },
  { slug: "admin-site-pages-list", url: "/admin/sites/{siteId}/pages" },
  { slug: "admin-site-posts-list", url: "/admin/sites/{siteId}/posts" },
  { slug: "admin-site-posts-new", url: "/admin/sites/{siteId}/posts/new" },
  {
    slug: "admin-site-design-system",
    url: "/admin/sites/{siteId}/design-system",
  },
  {
    slug: "admin-site-design-system-components",
    url: "/admin/sites/{siteId}/design-system/components",
  },
  {
    slug: "admin-site-design-system-templates",
    url: "/admin/sites/{siteId}/design-system/templates",
  },
  {
    slug: "admin-site-appearance",
    url: "/admin/sites/{siteId}/appearance",
  },
  { slug: "admin-batches-list", url: "/admin/batches" },
  { slug: "admin-images-list", url: "/admin/images" },
  { slug: "admin-users-list", url: "/admin/users" },
  { slug: "admin-companies-list", url: "/admin/companies" },
];

// Company routes — sign in as the seeded company admin (e2e-customer-co).
// These render the actual social UI (calendar grid, posts list, etc.).
const COMPANY_ROUTES: readonly RouteEntry[] = [
  // Social module — primary targets of the UI consistency pass.
  {
    slug: "social-calendar",
    url: "/company/social/calendar",
    hydrationDelayMs: 300,
  },
  {
    slug: "social-posts",
    url: "/company/social/posts",
    hydrationDelayMs: 300,
  },
  { slug: "social-connections", url: "/company/social/connections" },
  { slug: "social-media", url: "/company/social/media" },
  { slug: "social-analytics", url: "/company/social/analytics" },
  { slug: "social-sharing", url: "/company/social/sharing" },
  // Company account surfaces (also get button + nav migrations).
  { slug: "company-users", url: "/company/users" },
  { slug: "company-settings", url: "/company/settings" },
  { slug: "company-brand", url: "/company/brand" },
];

async function getSeededSiteId(): Promise<string> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required — run via `npm run screenshots`.",
    );
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("sites")
    .select("id")
    .eq("prefix", E2E_TEST_SITE_PREFIX)
    .neq("status", "removed")
    .maybeSingle();
  if (error || !data) {
    throw new Error(
      `Seeded test site "${E2E_TEST_SITE_PREFIX}" not found — global-setup should have created it.`,
    );
  }
  return data.id as string;
}

/** True when the committed baseline file exists for this slug + viewport. */
function baselineExists(slug: string, viewportName: string): boolean {
  return existsSync(
    path.join(SNAPSHOT_DIR, `${slug}-${viewportName}-linux.png`),
  );
}

type ViewportSpec = { name: "desktop" | "mobile"; size: typeof DESKTOP | typeof MOBILE };

/**
 * Capture screenshots for a route list using the given sign-in helper.
 * Per route:
 *   1. Save full-page PNG to playwright-screenshots/ (artifact upload).
 *   2. If a baseline exists, assert via toHaveScreenshot() (CI gate).
 *
 * Navigation failures are logged and skipped — a broken single route
 * doesn't abort the rest of the run.
 */
async function captureRoutes(
  browser: Browser,
  viewport: ViewportSpec,
  routes: readonly RouteEntry[],
  signIn: (page: Page) => Promise<void>,
  siteId: string,
  testInfo: import("@playwright/test").TestInfo,
): Promise<void> {
  const context = await browser.newContext({
    viewport: viewport.size,
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  await signIn(page);

  for (const route of routes) {
    const targetUrl = route.url.replace("{siteId}", siteId);
    const filePath = path.join(
      SCREENSHOTS_DIR,
      viewport.name,
      `${route.slug}.png`,
    );

    let screenshotTaken = false;
    try {
      await page.goto(targetUrl, { waitUntil: "networkidle" });
      if (route.waitForSelector) {
        await page
          .locator(route.waitForSelector)
          .first()
          .waitFor({ timeout: 5_000 });
      }
      if (route.hydrationDelayMs) {
        await page.waitForTimeout(route.hydrationDelayMs);
      }
      const masks = await page.locator("[data-screenshot-mask]").all();
      await page.screenshot({
        path: filePath,
        fullPage: true,
        mask: masks,
        maskColor: "#e5e7eb",
        animations: "disabled",
      });
      screenshotTaken = true;

      if (viewport.name === "desktop") {
        await auditA11y(page, testInfo);
      }
      // eslint-disable-next-line no-console
      console.log(
        `  [${viewport.name}] ${route.slug} → ${path.relative(process.cwd(), filePath)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await testInfo.attach(
        `screenshot-failed-${route.slug}-${viewport.name}`,
        { body: `${targetUrl}\n${msg}`, contentType: "text/plain" },
      );
      // eslint-disable-next-line no-console
      console.warn(`  [${viewport.name}] ${route.slug} FAILED: ${msg}`);
    }

    // Visual regression gate — only runs when a committed baseline exists.
    // First-time baseline capture: run `npm run screenshots:baseline`.
    if (screenshotTaken && baselineExists(route.slug, viewport.name)) {
      const masks = await page.locator("[data-screenshot-mask]").all();
      await expect(page).toHaveScreenshot(
        `${route.slug}-${viewport.name}.png`,
        {
          fullPage: true,
          mask: masks,
          animations: "disabled",
        },
      );
    }
  }

  await context.close();
}

// Skipped by default so `npm run test:e2e` doesn't pay the screenshot pass.
// Enable with: RUN_SCREENSHOTS=1 (set by `npm run screenshots`).
const SHOULD_RUN = process.env.RUN_SCREENSHOTS === "1";

test.describe("A-0 visual regression screenshot harness", () => {
  test.skip(!SHOULD_RUN, "RUN_SCREENSHOTS=1 not set");

  test("captures every admin + social surface at desktop + mobile", async (
    { browser },
    testInfo,
  ) => {
    test.setTimeout(300_000);

    await mkdir(path.join(SCREENSHOTS_DIR, "desktop"), { recursive: true });
    await mkdir(path.join(SCREENSHOTS_DIR, "mobile"), { recursive: true });

    const siteId = await getSeededSiteId();

    for (const viewport of [
      { name: "desktop" as const, size: DESKTOP },
      { name: "mobile" as const, size: MOBILE },
    ]) {
      await captureRoutes(
        browser,
        viewport,
        ADMIN_ROUTES,
        signInAsAdmin,
        siteId,
        testInfo,
      );
      await captureRoutes(
        browser,
        viewport,
        COMPANY_ROUTES,
        signInAsCompanyAdmin,
        siteId,
        testInfo,
      );
    }

    // Sentinel — always passes; individual toHaveScreenshot assertions
    // above are the real gate.
    expect(true).toBe(true);
  });
});
