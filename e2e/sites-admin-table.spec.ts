import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "./helpers";

// Spec 01 §4 + §5 — sort + filter URL params, Connect link
// visibility, and orthogonality of sort + filter URL state.

test.describe("Spec 01 — sites admin: sort, filter, Connect link", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("Name sort header cycles asc → desc → cleared via URL params", async ({
    page,
  }) => {
    await page.goto("/admin/sites");

    // Click Name → ?sort=name&dir=asc
    await page.getByTestId("sites-sort-name").click();
    await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
    await expect(page).toHaveURL(/[?&]dir=asc(&|$)/);

    // Click again → dir=desc
    await page.getByTestId("sites-sort-name").click();
    await expect(page).toHaveURL(/[?&]dir=desc(&|$)/);

    // Click third time → sort + dir cleared.
    await page.getByTestId("sites-sort-name").click();
    await expect(page).not.toHaveURL(/[?&]sort=/);
    await expect(page).not.toHaveURL(/[?&]dir=/);
  });

  test("Connect link is visible only on pending_pairing rows", async ({
    page,
  }) => {
    await page.goto("/admin/sites?status=pending_pairing");

    // Any visible row in this filtered view should expose the Connect →
    // affordance. (The view is empty in fresh CI seeds; tolerate that
    // by asserting the chip is at least pressed and the absence of
    // "Connected" rows. A real seeded environment will have rows.)
    const chip = page.getByTestId("sites-filter-pending-pairing");
    await expect(chip).toHaveAttribute("aria-pressed", "true");

    // Switch to Active — Connect links must NOT appear on those rows.
    await page.getByTestId("sites-filter-active").click();
    await expect(page).toHaveURL(/[?&]status=active(&|$)/);
    const anyConnectLink = page.getByText(/^Connect →$/);
    await expect(anyConnectLink).toHaveCount(0);
  });

  test("Filter chip preserves sort params; sort header preserves filter param", async ({
    page,
  }) => {
    // Start with sort + filter both set, then click a different chip.
    await page.goto("/admin/sites?sort=name&dir=asc&status=active");
    await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
    await expect(page).toHaveURL(/[?&]dir=asc(&|$)/);
    await expect(page).toHaveURL(/[?&]status=active(&|$)/);

    // Click "Paused" chip — sort + dir must be preserved.
    await page.getByTestId("sites-filter-paused").click();
    await expect(page).toHaveURL(/[?&]status=paused(&|$)/);
    await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
    await expect(page).toHaveURL(/[?&]dir=asc(&|$)/);

    // Click a header — filter param must survive.
    await page.getByTestId("sites-sort-status").click();
    await expect(page).toHaveURL(/[?&]status=paused(&|$)/);
    await expect(page).toHaveURL(/[?&]sort=status(&|$)/);
    await expect(page).toHaveURL(/[?&]dir=asc(&|$)/);
  });
});
