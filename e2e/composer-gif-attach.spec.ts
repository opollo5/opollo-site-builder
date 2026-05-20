import { test, expect } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// PR 2.3 — GIF picker → attach as media (gap A2)
//
// Tests:
//  G-1  GIF picker opens and renders category tabs + grid
//  G-2  Selecting a GIF attaches it as a media tile, not text in textarea
//  G-3  "Powered by GIPHY" attribution is visible
// ---------------------------------------------------------------------------

const MOCK_GIF_STORAGE_URL = "https://example.com/gifs/test.gif";
const MOCK_GIF_PREVIEW_URL = "https://media.giphy.com/media/gif1/preview.gif";

const MOCK_GIF_SEARCH_RESPONSE = {
  ok: true,
  data: {
    results: [
      {
        id: "gif1",
        title: "Test GIF",
        preview_url: MOCK_GIF_PREVIEW_URL,
        animated_url: "https://media.giphy.com/media/gif1/animated.gif",
        original_url: "https://media.giphy.com/media/gif1/original.gif",
      },
      {
        id: "gif2",
        title: "Another GIF",
        preview_url: "https://media.giphy.com/media/gif2/preview.gif",
        animated_url: "https://media.giphy.com/media/gif2/animated.gif",
        original_url: "https://media.giphy.com/media/gif2/original.gif",
      },
    ],
  },
};

const MOCK_GIF_PROXY_RESPONSE = {
  ok: true,
  data: { asset: { source_url: MOCK_GIF_STORAGE_URL } },
  timestamp: new Date().toISOString(),
};

test.describe("composer GIF attach (A2)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    // Override gif-search and gif-proxy with stable mocks
    await context.route("**/api/platform/social/gif-search**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_GIF_SEARCH_RESPONSE),
      });
    });
    await context.route("**/api/platform/social/gif-proxy", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MOCK_GIF_PROXY_RESPONSE),
      });
    });
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  });

  test("(G-1) GIF picker — opens with category tabs and GIF grid", async ({ page }) => {
    await page.locator('[data-testid="composer-tool-gif"]').click();

    await expect(page.getByRole("tab", { name: "Trending" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Reactions" })).toBeVisible();
    await expect(page.getByTestId("gif-grid")).toBeVisible();
  });

  test("(G-2) selecting a GIF attaches it as media tile, not textarea text", async ({ page }) => {
    await page.locator('[data-testid="composer-tool-gif"]').click();

    const gifGrid = page.getByTestId("gif-grid");
    await expect(gifGrid).toBeVisible({ timeout: 5_000 });

    const firstGif = gifGrid.getByRole("button").first();
    await expect(firstGif).toBeVisible({ timeout: 5_000 });
    await firstGif.click();

    // GIF is proxied to storage and attached as a media tile
    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });

    // Textarea should NOT contain a giphy URL
    const textareaValue = await page.getByTestId("content-textarea").inputValue();
    expect(textareaValue).not.toContain("giphy.com");
    expect(textareaValue).not.toContain("http");
  });

  test("(G-3) GIF picker shows 'Powered by GIPHY' attribution", async ({ page }) => {
    await page.locator('[data-testid="composer-tool-gif"]').click();

    await expect(page.getByText("Powered by GIPHY")).toBeVisible();
  });
});
