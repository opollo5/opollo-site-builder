import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";
import { E2E_TEST_SITE_PREFIX } from "./fixtures";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// A-0 — Visual regression screenshot harness for the polish workstream.
//
// Captures every admin surface at two viewports:
//   - Desktop  1440×900 (Linear / Vercel reference)
//   - Mobile    380×844 (iPhone-class width floor)
//
// Output: `playwright-screenshots/<viewport>/<route-slug>.png`
//
// Each Phase B per-screen PR overwrites the screenshots for the surfaces
// it touches. GitHub renders the PNG diff in the PR's Files Changed view
// — that's the canonical "before / after" for review (no manual paste).
// PR description references the affected files by path.
//
// Determinism notes:
//   - Time-rendered surfaces ("updated 2 minutes ago") are masked at
//     screenshot time so a clock tick doesn't churn the diff.
//   - Per-route, we wait for `networkidle` so SSR + client-side
//     hydration both settle before the snapshot.
//   - Animations are disabled via `reducedMotion: "reduce"` page
//     context option — every PR's screenshots represent the
//     reduced-motion "static" view of the surface, which is the
//     stable-by-design end state.
//
// Skip semantics:
//   - Routes that require seeded data we don't have (specific brief in
//     `awaiting_review`, specific WP post id) capture the empty/redirect
//     state instead. That's still useful — empty states are part of
//     the polish surface area.
// ---------------------------------------------------------------------------

const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 380, height: 844 } as const;

const SCREENSHOTS_DIR = path.join(process.cwd(), "playwright-screenshots");

interface RouteEntry {
  /** Slug used for the filename (alphanumerics + hyphens only). */
  slug: string;
  /** Route to navigate to. `{siteId}` is replaced with the seeded test site's id. */
  url: string;
  /** Optional wait condition: a selector to wait for before the snapshot. */
  waitForSelector?: string;
  /** Optional ms wait after navigation for any client-side hydration. */
  hydrationDelayMs?: number;
}

const ROUTES: readonly RouteEntry[] = [
  // Auth surfaces (no sign-in required — the harness signs out for these).
  { slug: "login", url: "/login" },
  { slug: "auth-forgot-password", url: "/auth/forgot-password" },
  // Admin surfaces (sign-in required).
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
];

async function getSeededSiteId(): Promise<string> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required for the screenshot harness — run via `npm run screenshots`.",
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

// Skipped by default so the regular `npm run test:e2e` pipeline doesn't
// pay the ~2-minute screenshot pass on every CI run. `npm run screenshots`
// flips RUN_SCREENSHOTS=1 to enable.
const SHOULD_RUN = process.env.RUN_SCREENSHOTS === "1";

test.describe("A-0 visual regression screenshot harness", () => {
  test.skip(!SHOULD_RUN, "RUN_SCREENSHOTS=1 not set");

  test("captures every admin surface at desktop + mobile", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    await mkdir(path.join(SCREENSHOTS_DIR, "desktop"), { recursive: true });
    await mkdir(path.join(SCREENSHOTS_DIR, "mobile"), { recursive: true });

    const siteId = await getSeededSiteId();

    for (const viewport of [
      { name: "desktop", size: DESKTOP },
      { name: "mobile", size: MOBILE },
    ] as const) {
      // Fresh context per viewport — reduced-motion + viewport are
      // browser-context level, can't be flipped per-page.
      const context = await browser.newContext({
        viewport: viewport.size,
        reducedMotion: "reduce",
        // Pin the locale + timezone so any date-formatted text is stable.
        locale: "en-US",
        timezoneId: "UTC",
      });
      const page = await context.newPage();

      // Sign in once per viewport (cookie sticks for subsequent
      // navigations within this context).
      await signInAsAdmin(page);

      for (const route of ROUTES) {
        const targetUrl = route.url.replace("{siteId}", siteId);
        const filePath = path.join(
          SCREENSHOTS_DIR,
          viewport.name,
          `${route.slug}.png`,
        );

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
          // Mask "updated N minutes ago" style relative timestamps so a
          // clock tick between PRs doesn't reorder the diff.
          const masks = await page.locator("[data-screenshot-mask]").all();
          await page.screenshot({
            path: filePath,
            fullPage: true,
            mask: masks,
            animations: "disabled",
          });
          // C-3 — run axe-core on every captured route. Findings
          // attach to the test result; non-blocking by design (the
          // harness still produces screenshots even if axe surfaces
          // violations) but visible in the CI run output for triage.
          // Desktop-viewport pass only — running on both viewports
          // doubles audit time and rarely finds viewport-specific
          // a11y issues.
          if (viewport.name === "desktop") {
            await auditA11y(page, testInfo);
          }
          // eslint-disable-next-line no-console
          console.log(
            `  [${viewport.name}] ${route.slug} → ${path.relative(process.cwd(), filePath)}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await testInfo.attach(`screenshot-failed-${route.slug}-${viewport.name}`, {
            body: `${targetUrl}\n${msg}`,
            contentType: "text/plain",
          });
          // eslint-disable-next-line no-console
          console.warn(
            `  [${viewport.name}] ${route.slug} FAILED: ${msg}`,
          );
        }
      }

      await context.close();
    }

    expect(true).toBe(true);
  });
});
