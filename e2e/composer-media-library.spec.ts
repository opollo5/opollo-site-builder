import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis, MOCK_MEDIA_URL } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 5.1 / C2 — Media picker modal: Library tab
//
// (ML-1) Opening the Library tab shows a grid of assets from the media API.
// (ML-2) Clicking two items then "Use selected" attaches both to the draft.
// ---------------------------------------------------------------------------

const MOCK_ASSETS = [
  {
    id: "asset-001",
    source_url: "https://picsum.photos/seed/a001/200/200",
    mime_type: "image/jpeg",
    bytes: 24000,
    created_at: "2026-05-20T10:00:00Z",
  },
  {
    id: "asset-002",
    source_url: "https://picsum.photos/seed/a002/200/200",
    mime_type: "image/jpeg",
    bytes: 18000,
    created_at: "2026-05-20T09:00:00Z",
  },
  {
    id: "asset-003",
    source_url: "https://picsum.photos/seed/a003/200/200",
    mime_type: "image/gif",
    bytes: 42000,
    created_at: "2026-05-20T08:00:00Z",
  },
];

test.describe("composer media picker modal (C2)", () => {
  test("(ML-1) Library tab renders asset grid", async ({ page, context }) => {
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
          data: { assets: MOCK_ASSETS, next_cursor: null },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    // Open media picker via ToolsRow "Media" button
    await page.getByRole("button", { name: /media/i }).click();
    await expect(page.getByTestId("media-picker-modal")).toBeVisible({ timeout: 5_000 });

    // Switch to Library tab
    await page.getByTestId("media-picker-tab-library").click();
    await expect(page.getByTestId("media-library-grid")).toBeVisible({ timeout: 5_000 });

    // All 3 assets visible
    await expect(page.getByTestId("media-library-item-asset-001")).toBeVisible();
    await expect(page.getByTestId("media-library-item-asset-002")).toBeVisible();
    await expect(page.getByTestId("media-library-item-asset-003")).toBeVisible();
  });

  test("(ML-2) Selecting 2 items and clicking Use selected attaches both to media tray", async ({
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
          data: { assets: MOCK_ASSETS, next_cursor: null },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    await page.getByRole("button", { name: /media/i }).click();
    await expect(page.getByTestId("media-picker-modal")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("media-picker-tab-library").click();
    await expect(page.getByTestId("media-library-grid")).toBeVisible({ timeout: 5_000 });

    // Click two assets
    await page.getByTestId("media-library-item-asset-001").click();
    await page.getByTestId("media-library-item-asset-002").click();

    // Confirm Use selected button shows count
    const useBtn = page.getByTestId("media-library-use-selected");
    await expect(useBtn).toContainText("2");

    await useBtn.click();

    // Modal closes
    await expect(page.getByTestId("media-picker-modal")).not.toBeVisible({ timeout: 3_000 });

    // MediaTray should show 2 tiles
    await expect(page.getByTestId("media-tray")).toBeVisible();
    await expect(page.getByTestId("media-tile-0")).toBeVisible();
    await expect(page.getByTestId("media-tile-1")).toBeVisible();
  });

  test("(ML-3) Upload tab shows dropzone, cancel closes modal", async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    await page.getByRole("button", { name: /media/i }).click();
    await expect(page.getByTestId("media-picker-modal")).toBeVisible({ timeout: 5_000 });

    // Upload tab active by default
    await expect(page.getByTestId("media-upload-dropzone")).toBeVisible();

    // Cancel closes
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("media-picker-modal")).not.toBeVisible({ timeout: 3_000 });
  });
});
