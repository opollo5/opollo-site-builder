import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 5.2 — ComposerErrorBoundary + admin /errors page E2E tests.
//
// EB-1: Admin errors page renders (no errors state or table).
// EB-2: Admin errors page is gated — unauthenticated user is redirected.
// ---------------------------------------------------------------------------

test.describe("admin client errors page (Phase 5.2)", () => {
  test("EB-1: admin errors page renders for super_admin", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/errors");
    await page.waitForSelector('[data-testid="client-errors-table-container"]');
    // Either the empty state or the table is present.
    const isEmpty = await page.locator('[data-testid="client-errors-empty"]').isVisible();
    const hasTable = await page.locator('[data-testid="client-errors-table"]').isVisible();
    expect(isEmpty || hasTable).toBeTruthy();
  });

  test("EB-2: unauthenticated user is redirected away from /admin/errors", async ({
    page,
  }) => {
    await page.goto("/admin/errors");
    // Should redirect to /login or / — not stay on /admin/errors.
    await page.waitForURL((url) => !url.pathname.startsWith("/admin/errors"), {
      timeout: 5000,
    });
    expect(page.url()).not.toContain("/admin/errors");
  });
});
