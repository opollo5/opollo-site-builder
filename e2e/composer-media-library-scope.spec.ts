import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// PR-C1 — Media library global scope
//
// (MLS-1) Library fetch sends include_global=true so staff-promoted assets
//         are returned alongside company assets.
// (MLS-2) A global-scoped asset returned by the API appears in the grid
//         alongside a company-scoped asset.
// ---------------------------------------------------------------------------

const COMPANY_ASSET = {
  id: "asset-company-c1",
  source_url: "https://picsum.photos/seed/co1/200/200",
  mime_type: "image/jpeg",
  bytes: 24000,
  scope: "company",
  created_at: "2026-05-21T10:00:00Z",
};

const GLOBAL_ASSET = {
  id: "asset-global-c1",
  source_url: "https://picsum.photos/seed/gl1/200/200",
  mime_type: "image/jpeg",
  bytes: 32000,
  scope: "global",
  created_at: "2026-05-21T09:00:00Z",
};

test.describe("composer media library scope (C1)", () => {
  test("(MLS-1) library fetch includes include_global=true", async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });

    let capturedUrl: string | null = null;
    await context.route("**/api/platform/social/media**", (route) => {
      capturedUrl = route.request().url();
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { assets: [COMPANY_ASSET, GLOBAL_ASSET], next_cursor: null },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    await page.getByRole("button", { name: /media/i }).click();
    await expect(page.getByTestId("media-picker-modal")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("media-picker-tab-library").click();
    await expect(page.getByTestId("media-library-grid")).toBeVisible({ timeout: 5_000 });

    expect(capturedUrl).toContain("include_global=true");
  });

  test("(MLS-2) global-scoped asset appears in grid alongside company asset", async ({
    page,
    context,
  }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });

    await context.route("**/api/platform/social/media**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { assets: [COMPANY_ASSET, GLOBAL_ASSET], next_cursor: null },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    await page.getByRole("button", { name: /media/i }).click();
    await expect(page.getByTestId("media-picker-modal")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("media-picker-tab-library").click();
    await expect(page.getByTestId("media-library-grid")).toBeVisible({ timeout: 5_000 });

    await expect(
      page.getByTestId(`media-library-item-${COMPANY_ASSET.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`media-library-item-${GLOBAL_ASSET.id}`),
    ).toBeVisible();
  });
});
