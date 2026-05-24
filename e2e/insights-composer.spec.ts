import { expect, test } from "@playwright/test";
import { mockComposerApis, signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// PR-08 E2E — Insights sidebar in the composer
//
// Tests the full flow:
//   1. Open composer → insights sidebar appears
//   2. Click "See evidence" → EvidenceDetail Sheet slides in from right
//   3. Dismiss a recommendation → it disappears from the list
// ---------------------------------------------------------------------------

const MOCK_REC_1_ID = "rec-00000000-0000-0000-0000-000000000001";
const MOCK_REC_2_ID = "rec-00000000-0000-0000-0000-000000000002";
const MOCK_REC_3_ID = "rec-00000000-0000-0000-0000-000000000003";

const MOCK_RECS = [
  {
    id: MOCK_REC_1_ID,
    recommendation_type: "best_length_band",
    headline: "Keep it under 150 words for best results",
    body: "+38% engagement observed",
    confidence_band: "strong",
    confidence_score: 0.81,
  },
  {
    id: MOCK_REC_2_ID,
    recommendation_type: "best_posting_window",
    headline: "Post on Tuesday 10am",
    body: "2.4x median engagement",
    confidence_band: "strong",
    confidence_score: 0.77,
  },
  {
    id: MOCK_REC_3_ID,
    recommendation_type: "question_pattern_lift",
    headline: "Try ending with a question",
    body: "1.8x comments on question posts",
    confidence_band: "moderate",
    confidence_score: 0.55,
  },
];

const MOCK_CONNECTIONS = [
  {
    id: "conn-1",
    platform: "linkedin_company",
    display_name: "Test Company",
    avatar_url: null,
    status: "healthy",
  },
];

test.describe("Insights sidebar in composer", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
  });

  async function setupMocks(page: import("@playwright/test").Page) {
    // Connections API
    await page.route(`**/api/platform/social/connections*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: MOCK_CONNECTIONS } }),
      }),
    );

    // Recommendations API — returns all three by default
    await page.route(`**/api/insights/recommendations*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, recommendations: MOCK_RECS, postCount: 47 }),
      }),
    );

    // Evidence API
    await page.route(`**/api/insights/recommendations/*/evidence*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          evidence: [
            {
              id: "ev-1",
              source_table: "ins_post_features",
              source_row_ref: "post-ref-1",
              summary: "Short post with 12.4% engagement rate",
            },
          ],
        }),
      }),
    );

    // Dismiss API
    await page.route(`**/api/insights/recommendations/*/dismiss*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, suppressedAllOfType: false }),
      }),
    );
  }

  test("sidebar is visible when composer opens", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await setupMocks(page);
    await page.goto(`/company/social/posts?compose=new`);

    // Wait for composer overlay
    await expect(page.getByTestId("composer-overlay")).toBeVisible({ timeout: 20000 });

    const sidebar = page.getByTestId("insights-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 8000 });
    await expect(sidebar.getByText("Suggestions for this post")).toBeVisible();
  });

  test("sidebar shows recommendations after load", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await setupMocks(page);
    await page.goto(`/company/social/posts?compose=new`);

    await expect(page.getByTestId("composer-overlay")).toBeVisible({ timeout: 20000 });

    const sidebar = page.getByTestId("insights-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 8000 });

    // Wait for recs to load (skeleton disappears)
    await expect(sidebar.getByTestId("sidebar-skeleton")).not.toBeVisible({ timeout: 8000 });
    await expect(sidebar.getByText("Keep it under 150 words for best results")).toBeVisible();
    await expect(sidebar.getByText("Post on Tuesday 10am")).toBeVisible();
  });

  test("clicking See evidence opens Sheet from right", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await setupMocks(page);
    await page.goto(`/company/social/posts?compose=new`);

    await expect(page.getByTestId("composer-overlay")).toBeVisible({ timeout: 20000 });

    const sidebar = page.getByTestId("insights-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 8000 });
    await expect(sidebar.getByTestId("sidebar-skeleton")).not.toBeVisible({ timeout: 8000 });

    // Click See evidence on the first recommendation
    const evidenceBtns = sidebar.getByTestId("sidebar-see-evidence");
    await evidenceBtns.first().click();

    // evidence-sheet should appear (Sheet component)
    const sheet = page.getByTestId("evidence-sheet");
    await expect(sheet).toBeVisible({ timeout: 5000 });

    // Sheet is positioned on the right side of the viewport
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      // right-anchored: the sheet's right edge should be at or near the viewport right
      const viewportWidth = 1600;
      expect(box.x + box.width).toBeGreaterThan(viewportWidth - 100);
    }

    // Evidence row is displayed
    await expect(page.getByTestId("evidence-row")).toBeVisible();
  });

  test("dismissing a recommendation removes it from the sidebar", async ({ page }) => {
    let dismissCount = 0;
    await setupMocks(page);

    // Override recommendations to reflect dismissal
    await page.route(`**/api/insights/recommendations*`, (route) => {
      const url = route.request().url();
      // skip evidence and dismiss sub-routes
      if (url.includes("/dismiss") || url.includes("/evidence")) {
        route.continue();
        return;
      }
      // After dismissal, return fewer recs
      const remaining =
        dismissCount === 0
          ? MOCK_RECS
          : MOCK_RECS.filter((_, i) => i > 0);
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, recommendations: remaining, postCount: 47 }),
      });
    });

    await page.route(`**/api/insights/recommendations/*/dismiss*`, (route) => {
      dismissCount++;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, suppressedAllOfType: false }),
      });
    });

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/company/social/posts?compose=new`);

    await expect(page.getByTestId("composer-overlay")).toBeVisible({ timeout: 20000 });
    const sidebar = page.getByTestId("insights-sidebar");
    await expect(sidebar).toBeVisible({ timeout: 8000 });
    await expect(sidebar.getByTestId("sidebar-skeleton")).not.toBeVisible({ timeout: 8000 });

    // Open dismissal modal for first rec
    const dismissBtns = sidebar.getByTestId("sidebar-dismiss-btn");
    await dismissBtns.first().click();

    const modal = page.getByTestId("dismissal-modal");
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Three-strike warning is visible
    await expect(page.getByTestId("three-strike-warning")).toBeVisible();

    // Select a reason and confirm
    await page.getByTestId("reason-not_relevant").locator("input").click();
    await page.getByTestId("dismiss-confirm").click();

    // Modal closes and rec disappears from sidebar
    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await expect(
      sidebar.getByText("Keep it under 150 words for best results"),
    ).not.toBeVisible();
  });
});
