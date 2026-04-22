import { expect, test } from "@playwright/test";

import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M11-5 — admin tenant-budget surface coverage.
//
// Pins two contracts on /admin/sites/[id]:
//
//   1. The badge renders with daily + monthly rows + the Edit caps CTA
//      after the M8-1 migration's auto-create trigger populated
//      tenant_cost_budgets for the E2E site. Runs auditA11y() per the
//      E2E discipline rule.
//
//   2. A stale-version PATCH against /api/admin/sites/[id]/budget
//      returns 409 VERSION_CONFLICT with the current server-side
//      version in details.current_version. Pinned via
//      `page.request.patch` so the assertion doesn't depend on modal
//      timing or client-side formatting.
//
// A fuller spec covering modal open + invalid-input guard + valid
// PATCH round-trip is tracked in docs/BACKLOG.md "M11-5 polish —
// modal + inline-error + happy-path UI" so the next UI pass can
// harden it without blocking this launch slice.
//
// Precondition: global-setup seeds an active site with prefix "e2e".
// Migration 0012's auto-create trigger backfills tenant_cost_budgets
// for every new site, so the row exists by the time the test runs.
// ---------------------------------------------------------------------------

async function openSiteDetail(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/admin/sites");
  const row = page.getByRole("row", { name: /E2E Test Site/i });
  await row.getByRole("link", { name: "E2E Test Site" }).click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
  const match = page.url().match(/\/admin\/sites\/([0-9a-f-]{36})/);
  if (!match) throw new Error("Could not extract site UUID from URL.");
  return match[1];
}

test.describe("tenant-budget admin surface", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("badge renders with daily + monthly rows + edit button", async ({
    page,
  }, testInfo) => {
    await openSiteDetail(page);

    const badge = page.getByTestId("tenant-budget-badge");
    await expect(badge).toBeVisible();
    await expect(badge.getByText(/daily/i)).toBeVisible();
    await expect(badge.getByText(/monthly/i)).toBeVisible();
    await expect(
      page.getByTestId("edit-tenant-budget-button"),
    ).toBeVisible();

    await auditA11y(page, testInfo);
  });

  test("stale-version PATCH surfaces VERSION_CONFLICT at the API layer", async ({
    page,
  }) => {
    const siteId = await openSiteDetail(page);

    // Probe with a guaranteed-stale version (999_999 will never match
    // the real version_lock). The API's VERSION_CONFLICT branch echoes
    // details.current_version, pinning both (a) the 409 contract the
    // UI relies on and (b) the details shape a future test could use
    // to learn the live version without a dedicated GET route.
    const probe = await page.request.patch(
      `/api/admin/sites/${siteId}/budget`,
      {
        data: {
          expected_version: 999_999,
          patch: { daily_cap_cents: 0 },
        },
      },
    );
    expect(probe.status()).toBe(409);
    const payload = await probe.json();
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "VERSION_CONFLICT" },
    });
    expect(typeof payload?.error?.details?.current_version).toBe("number");
  });
});
