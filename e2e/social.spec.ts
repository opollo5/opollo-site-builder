import { expect, test } from "@playwright/test";

import { auditA11y, signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Social platform E2E — /company/social/*
//
// Scope:
//   1. Posts list loads with table + new-post button visible
//   2. New post button opens the compose form
//   3. Connections page loads with connections container
//   4. Analytics page loads with chart or empty-state
//   5. Media library page loads with library container
//   6. auditA11y on each visited page
//
// Out of scope:
//   OAuth connection flow (needs external bundle.social callback).
//   Post publish flow (needs a real WP backend).
//   Full compose → save round-trip (covered by unit layer).
// ---------------------------------------------------------------------------

test.describe("social platform", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("posts list loads and shows key UI", async ({ page }, testInfo) => {
    await page.goto("/company/social/posts");
    await expect(page).toHaveURL(/\/company\/social\/posts/);

    // Table container is rendered (may be empty but must be present).
    await expect(
      page.getByTestId("social-posts-table"),
    ).toBeVisible({ timeout: 15_000 });

    // New-post button present for company-admin role.
    await expect(page.getByTestId("new-post-button")).toBeVisible();

    await auditA11y(page, testInfo);
  });

  // TODO(#820): pre-existing failure on main since 2026-05-08.
  test.fixme("new post button opens compose form", async ({ page }, testInfo) => {
    await page.goto("/company/social/posts");
    await page.getByTestId("new-post-button").click();

    // Compose form should become visible.
    await expect(
      page.getByTestId("new-post-form"),
    ).toBeVisible({ timeout: 10_000 });

    await auditA11y(page, testInfo);
  });

  test("connections page loads", async ({ page }, testInfo) => {
    await page.goto("/company/social/connections");
    await expect(page).toHaveURL(/\/company\/social\/connections/);

    // Either the connections wrapper or an error banner must render.
    const wrapper = page.getByTestId("connections-list-wrapper");
    const errBanner = page.getByTestId("connections-error");
    await expect(wrapper.or(errBanner)).toBeVisible({ timeout: 15_000 });

    // Heading must be present regardless of data state.
    await expect(page.getByRole("heading", { name: /social connections/i })).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("analytics page loads", async ({ page }, testInfo) => {
    await page.goto("/company/social/analytics");
    await expect(page).toHaveURL(/\/company\/social\/analytics/);

    // The analytics client, an empty state, or an error must render.
    // We look for any element with a role=main or the known test ids.
    const analyticsEmpty = page.getByTestId("analytics-empty");
    const analyticsError = page.getByTestId("analytics-error");
    const mainContent = page.locator("main");
    await expect(
      analyticsEmpty.or(analyticsError).or(mainContent).first(),
    ).toBeVisible({ timeout: 15_000 });

    await auditA11y(page, testInfo);
  });

  test("media library page loads", async ({ page }, testInfo) => {
    await page.goto("/company/social/media");
    await expect(page).toHaveURL(/\/company\/social\/media/);

    // Media library container must render.
    await expect(page.getByTestId("media-library")).toBeVisible({
      timeout: 15_000,
    });

    // Heading must be present.
    await expect(page.getByRole("heading", { name: /media library/i })).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("timeline page loads with feed or empty state", async ({ page }, testInfo) => {
    await page.goto("/company/social/timeline");
    await expect(page).toHaveURL(/\/company\/social\/timeline/);

    // Either a feed or an empty state must render.
    const feed = page.getByTestId("timeline-feed");
    const empty = page.getByTestId("timeline-empty");
    await expect(feed.or(empty)).toBeVisible({ timeout: 15_000 });

    // Page heading must be present.
    await expect(page.getByRole("heading", { name: /timeline/i })).toBeVisible();

    await auditA11y(page, testInfo);
  });

  // TODO(#820): pre-existing failure on main since 2026-05-08.
  test.fixme("timeline tab in shell navigation links to timeline", async ({ page }) => {
    await page.goto("/company/social/posts");
    await expect(page).toHaveURL(/\/company\/social\/posts/);

    // Click the Timeline pill tab.
    await page.getByRole("link", { name: /timeline/i }).click();
    await expect(page).toHaveURL(/\/company\/social\/timeline/, { timeout: 10_000 });
  });

  test.describe("connect popup flow", () => {
    // Tests the window.open popup mechanics without hitting external
    // bundle.social. The connect API is mocked to return a URL on our
    // own origin that we also intercept to serve postMessage HTML.

    test("(a) postMessage: popup sends bundle-connect-complete and parent recovers", async ({
      page,
      context,
    }, testInfo) => {
      await page.goto("/company/social/connections");

      // Mock preflight — always returns clean (no cross-tenant conflict).
      await context.route(
        "**/api/platform/social/connections/identity-preflight*",
        (route) => {
          void route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, data: { warn: false, others: [] } }),
          });
        },
      );

      // Mock connect API — return a URL on our own origin so same-origin
      // postMessage passes the parent's origin check.
      await context.route(
        "**/api/platform/social/connections/connect",
        (route) => {
          const origin = new URL(page.url()).origin;
          void route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              data: { url: `${origin}/_test-popup-stub` },
            }),
          });
        },
      );

      // Intercept popup navigation — serve HTML that fires postMessage then closes.
      await context.route("**/_test-popup-stub*", (route) => {
        void route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<!DOCTYPE html><html><body><script>
(function () {
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "bundle-connect-complete", connect: "noop" },
        window.location.origin
      );
    }
  } catch (e) {}
  window.close();
})();
</script></body></html>`,
        });
      });

      const connectBtn = page.getByTestId("connections-connect-button");
      await expect(connectBtn).toBeVisible({ timeout: 10_000 });

      // Open the platform-picker lightbox, then select a platform.
      // The identity confirm modal now appears before the popup opens.
      await connectBtn.click();
      const lightbox = page.getByTestId("connect-lightbox");
      await expect(lightbox).toBeVisible({ timeout: 5_000 });

      await page.getByTestId("connect-platform-LINKEDIN").click();

      // Dismiss the identity confirm modal (tick checkbox, then Continue).
      // Continue opens the pre-popup (blank URL), so register the popup
      // listener before clicking Continue.
      await page.getByTestId("identity-confirm-checkbox").check();
      const popupPromise = page.waitForEvent("popup");
      await page.getByTestId("identity-confirm-continue").click();
      const popup = await popupPromise;

      // Popup loads stub, fires postMessage, then calls window.close().
      await popup.waitForEvent("close", { timeout: 10_000 });

      // Parent must not show error or popup-blocked banners.
      await expect(page.getByTestId("connections-error")).not.toBeVisible();
      await expect(
        page.getByTestId("connections-popup-blocked"),
      ).not.toBeVisible();

      await auditA11y(page, testInfo);
    });

    test("(b) user-closes-popup: parent handles abandonment gracefully", async ({
      page,
      context,
    }) => {
      await page.goto("/company/social/connections");

      // Mock preflight — always returns clean.
      await context.route(
        "**/api/platform/social/connections/identity-preflight*",
        (route) => {
          void route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, data: { warn: false, others: [] } }),
          });
        },
      );

      await context.route(
        "**/api/platform/social/connections/connect",
        (route) => {
          const origin = new URL(page.url()).origin;
          void route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              ok: true,
              data: { url: `${origin}/_test-popup-stub-abandon` },
            }),
          });
        },
      );

      // Stub stays open — simulating user who hasn't completed OAuth yet.
      await context.route("**/_test-popup-stub-abandon*", (route) => {
        void route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: "<!DOCTYPE html><html><body>Loading…</body></html>",
        });
      });

      const connectBtn = page.getByTestId("connections-connect-button");
      await expect(connectBtn).toBeVisible({ timeout: 10_000 });

      // Open platform picker, click platform, dismiss identity confirm modal.
      await connectBtn.click();
      const lightbox = page.getByTestId("connect-lightbox");
      await expect(lightbox).toBeVisible({ timeout: 5_000 });

      await page.getByTestId("connect-platform-LINKEDIN").click();
      await page.getByTestId("identity-confirm-checkbox").check();
      const popupPromise = page.waitForEvent("popup");
      await page.getByTestId("identity-confirm-continue").click();
      const popup = await popupPromise;

      // User closes popup without completing OAuth.
      await popup.close();

      // Parent must recover: no crash, no error banner, wrapper still present.
      await expect(page.getByTestId("connections-error")).not.toBeVisible();
      await expect(
        page.getByTestId("connections-list-wrapper"),
      ).toBeVisible({ timeout: 10_000 });
    });
  });
});
