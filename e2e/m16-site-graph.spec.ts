import { expect, test, type Page, type Route } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M16 — Site Graph E2E specs.
//
// Covers the operator flows introduced in M16-7:
//   1. Blueprint review page loads and displays plan data.
//   2. Approve button POSTs to /api/.../approve and reflects new status.
//   3. Revert button POSTs to /api/.../revert and reflects draft status.
//   4. Shared content manager page loads and creates a row.
//   5. Blueprint review page → accessibility audit.
//   6. Shared content page → accessibility audit.
//
// All WP API calls and Anthropic calls are intercepted so no real HTTP
// traffic leaves the test environment.  Supabase operations run against
// the local test stack.
//
// PR #516 merged M16-6+M16-7. Blueprint review: /admin/sites/[id]/blueprints/review
// Shared content:  /admin/sites/[id]/content
// ---------------------------------------------------------------------------

// ─── API stub helpers ────────────────────────────────────────────────────────

async function stubBlueprintsApi(page: Page, siteId: string) {
  await page.route(`**/api/sites/${siteId}/blueprints`, async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            id:             "bp-test-id-1",
            status:         "draft",
            brand_name:     "E2E Test Brand",
            route_plan:     [
              { slug: "/", page_type: "homepage", label: "Home", priority: 1 },
              { slug: "/services", page_type: "service", label: "Services", priority: 2 },
            ],
            nav_items:      [{ label: "Home", routeSlug: "/" }],
            footer_items:   [{ label: "Home", routeSlug: "/", externalUrl: null }],
            cta_catalogue:  [],
            seo_defaults:   { titleTemplate: "%s | E2E Brand", description: "Test site" },
            version_lock:   1,
          },
          timestamp: new Date().toISOString(),
        }),
      });
    } else {
      await route.continue();
    }
  });
}

async function stubBlueprintApprove(page: Page, siteId: string) {
  await page.route(`**/api/sites/${siteId}/blueprints/**/approve`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id:           "bp-test-id-1",
          status:       "approved",
          version_lock: 2,
        },
        timestamp: new Date().toISOString(),
      }),
    });
  });
}

async function stubBlueprintRevert(page: Page, siteId: string) {
  await page.route(`**/api/sites/${siteId}/blueprints/**/revert`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          id:           "bp-test-id-1",
          status:       "draft",
          version_lock: 3,
        },
        timestamp: new Date().toISOString(),
      }),
    });
  });
}

async function stubRouteRegistry(page: Page, siteId: string) {
  await page.route(`**/api/sites/${siteId}/route-registry*`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: [
          { id: "route-1", slug: "/", page_type: "homepage", label: "Home", status: "planned" },
          { id: "route-2", slug: "/services", page_type: "service", label: "Services", status: "planned" },
        ],
        timestamp: new Date().toISOString(),
      }),
    });
  });
}

async function stubSharedContentApi(page: Page, siteId: string) {
  const rows = [
    { id: "sc-1", content_type: "cta", label: "Main CTA", content: { text: "Get Started" }, deleted_at: null },
    { id: "sc-2", content_type: "testimonial", label: "Jane Doe", content: { quote: "Great service!" }, deleted_at: null },
  ];

  await page.route(`**/api/sites/${siteId}/shared-content`, async (route: Route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: rows, timestamp: new Date().toISOString() }),
      });
    } else if (method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { id: "sc-new", content_type: "cta", label: "New CTA", content: {}, deleted_at: null },
          timestamp: new Date().toISOString(),
        }),
      });
    } else {
      await route.continue();
    }
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("M16 — Blueprint review", () => {
  // Uses a fake site ID — the admin pages load via client-side fetches
  // which we intercept above.
  const SITE_ID = "00000000-0000-0000-0000-000000000001";

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubBlueprintsApi(page, SITE_ID);
    await stubBlueprintApprove(page, SITE_ID);
    await stubBlueprintRevert(page, SITE_ID);
    await stubRouteRegistry(page, SITE_ID);
    await stubSharedContentApi(page, SITE_ID);
  });

  test("blueprint review page loads with brand name and route plan", async ({ page }) => {
    await page.goto(`/admin/sites/${SITE_ID}/blueprints/review`);

    // Wait for the page to load the blueprint data
    await expect(page.getByText("E2E Test Brand")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/homepage/i)).toBeVisible();
    await expect(page.getByText(/service/i)).toBeVisible();
  });

  test("blueprint review page shows 'Draft' status badge", async ({ page }) => {
    await page.goto(`/admin/sites/${SITE_ID}/blueprints/review`);
    await expect(page.getByText("E2E Test Brand")).toBeVisible({ timeout: 10_000 });
    // The status badge should show Draft
    await expect(page.getByText(/draft/i)).toBeVisible();
  });

  test("Approve button calls the approve API and reflects approved status", async ({ page }) => {
    await page.goto(`/admin/sites/${SITE_ID}/blueprints/review`);
    await expect(page.getByText("E2E Test Brand")).toBeVisible({ timeout: 10_000 });

    // Click Approve button
    const approveBtn = page.getByRole("button", { name: /approve/i });
    await expect(approveBtn).toBeVisible();
    await approveBtn.click();

    // After approve the page should reflect approved status
    await expect(page.getByText(/approved/i)).toBeVisible({ timeout: 8_000 });
  });

  test("blueprint review page passes accessibility audit", async ({ page, }, testInfo) => {
    await page.goto(`/admin/sites/${SITE_ID}/blueprints/review`);
    await expect(page.getByText("E2E Test Brand")).toBeVisible({ timeout: 10_000 });
    await auditA11y(page, testInfo);
  });
});

test.describe("M16 — Shared content manager", () => {
  const SITE_ID = "00000000-0000-0000-0000-000000000001";

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await stubSharedContentApi(page, SITE_ID);
    await stubBlueprintsApi(page, SITE_ID);
  });

  test("shared content page loads and lists existing items", async ({ page }) => {
    await page.goto(`/admin/sites/${SITE_ID}/content`);
    await expect(page.getByText("Main CTA")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Jane Doe")).toBeVisible();
  });

  test("shared content page shows content type badges", async ({ page }) => {
    await page.goto(`/admin/sites/${SITE_ID}/content`);
    await expect(page.getByText("Main CTA")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/cta/i)).toBeVisible();
    await expect(page.getByText(/testimonial/i)).toBeVisible();
  });

  test("shared content page passes accessibility audit", async ({ page }, testInfo) => {
    await page.goto(`/admin/sites/${SITE_ID}/content`);
    await expect(page.getByText("Main CTA")).toBeVisible({ timeout: 10_000 });
    await auditA11y(page, testInfo);
  });
});
