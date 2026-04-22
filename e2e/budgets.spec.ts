import { expect, test, type Page } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M11-5 — Tenant budget admin surface smoke test.
//
// M8-5 shipped the budget badge + PATCH endpoint with zero Playwright
// coverage (audit 2026-04-22 M8 partial finding). This spec locks the
// UI contract:
//
//   - Badge renders on /admin/sites/[id] with daily + monthly rows.
//   - Edit modal opens, updates caps via the PATCH endpoint, badge
//     reflects the new values after router.refresh().
//   - Stale-version PATCH surfaces VERSION_CONFLICT inline without
//     closing the modal.
//
// We drive the seeded E2E site (global-setup creates it with the
// auto-trigger budget row) rather than provisioning a new site per
// test. Playwright config pins `workers: 1` so serial execution
// means the cap mutations between tests don't race.
// ---------------------------------------------------------------------------

async function gotoE2ESiteDetail(page: Page): Promise<string> {
  await page.goto("/admin/sites");
  await page
    .getByRole("link", { name: "E2E Test Site" })
    .first()
    .click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
  return page.url();
}

test.describe("tenant budget admin surface", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("budget badge renders on site detail with daily + monthly rows", async ({
    page,
  }, testInfo) => {
    await gotoE2ESiteDetail(page);
    const badge = page.getByTestId("tenant-budget-badge");
    await expect(badge).toBeVisible();
    await expect(badge.getByText(/^Daily$/)).toBeVisible();
    await expect(badge.getByText(/^Monthly$/)).toBeVisible();
    await expect(badge.getByText(/^Resets /).first()).toBeVisible();
    await auditA11y(page, testInfo);
  });

  test("edit-caps modal updates the daily + monthly caps; badge reflects the new values", async ({
    page,
  }) => {
    await gotoE2ESiteDetail(page);
    await expect(page.getByTestId("edit-tenant-budget-button")).toBeVisible();
    await page.getByTestId("edit-tenant-budget-button").click();

    const daily = page.getByLabel(/daily cap/i);
    const monthly = page.getByLabel(/monthly cap/i);
    await expect(daily).toBeVisible();
    await daily.fill("17.50");
    await monthly.fill("275");
    await page.getByRole("button", { name: /save caps/i }).click();

    await expect(
      page.getByRole("dialog", { name: /edit budget caps/i }),
    ).toHaveCount(0);
    const badge = page.getByTestId("tenant-budget-badge");
    await expect(badge).toContainText("/ $17.50");
    await expect(badge).toContainText("/ $275.00");
  });

  test("stale-version PATCH surfaces a conflict without closing the modal", async ({
    page,
  }) => {
    const siteUrl = await gotoE2ESiteDetail(page);
    const siteId = siteUrl.split("/").pop() as string;

    // Open the modal so it captures whatever server-side version_lock
    // was rendered into the button's props.
    await page.getByTestId("edit-tenant-budget-button").click();

    // Bump the server-side version while the modal is open. Discover
    // the current version by retrying expected_version=1..20 until
    // one succeeds; the first success advances the row by one, which
    // is enough to stale out the open modal's snapshot.
    const bumped = await page.evaluate(async (id: string) => {
      for (let attempt = 1; attempt <= 20; attempt++) {
        const res = await fetch(
          `/api/admin/sites/${encodeURIComponent(id)}/budget`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              expected_version: attempt,
              patch: { daily_cap_cents: 100 * attempt + 7 },
            }),
          },
        );
        if (res.status === 200) {
          return { succeededAtVersion: attempt };
        }
      }
      throw new Error(
        "Could not find a matching expected_version within 20 attempts",
      );
    }, siteId);
    expect(bumped.succeededAtVersion).toBeGreaterThan(0);

    // Submit the open modal with its now-stale captured version. The
    // server rejects with VERSION_CONFLICT and the modal stays open
    // with an error alert.
    await page.getByLabel(/daily cap/i).fill("42");
    await page.getByRole("button", { name: /save caps/i }).click();

    const err = page.getByTestId("edit-tenant-budget-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(/version|conflict|stale/i);
    await expect(
      page.getByRole("dialog", { name: /edit budget caps/i }),
    ).toBeVisible();
  });
});
