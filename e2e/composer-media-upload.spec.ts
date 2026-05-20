import { test, expect } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis, MOCK_MEDIA_URL } from "./helpers";

// ---------------------------------------------------------------------------
// PR 2.2 — composer media upload render (gap A1)
//
// Tests:
//  M-1  Upload PNG → MediaTile renders with correct src
//  M-2  Upload exceeds 8 MB → inline client-side error containing "8 MB"
//  M-3  Uploaded image src propagates to media tile (source_url round-trip)
// ---------------------------------------------------------------------------

// Minimal valid 1×1 PNG (67 bytes)
const VALID_PNG_HEX =
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
  "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082";

test.describe("composer media upload (A1)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  });

  test("(M-1) upload PNG — MediaTile renders with correct src", async ({ page }) => {
    const pngBuffer = Buffer.from(VALID_PNG_HEX, "hex");
    const fileInput = page.getByTestId("media-file-input");
    await fileInput.setInputFiles({ name: "upload-test.png", mimeType: "image/png", buffer: pngBuffer });

    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });
    const imgSrc = await page.getByTestId("media-tile-0").locator("img").getAttribute("src");
    expect(imgSrc).toBeTruthy();
    expect(imgSrc).not.toBe("undefined");
  });

  test("(M-2) file over 8 MB — inline error with '8 MB'", async ({ page }) => {
    // Client-side guard fires before any upload request; no server mock needed.
    const oversizedBuffer = Buffer.alloc(8 * 1024 * 1024 + 1, 0);
    // PNG magic bytes so MIME check passes
    oversizedBuffer[0] = 0x89; oversizedBuffer[1] = 0x50;
    oversizedBuffer[2] = 0x4e; oversizedBuffer[3] = 0x47;

    const fileInput = page.getByTestId("media-file-input");
    await fileInput.setInputFiles({ name: "oversized.png", mimeType: "image/png", buffer: oversizedBuffer });

    // Use filter to avoid matching the always-present-but-empty ai-error-display alert
    const errorMsg = page.locator('[role="alert"]').filter({ hasText: "8 MB" });
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    const text = await errorMsg.textContent();
    expect(text).toContain("8 MB");
  });

  test("(M-3) uploaded image src propagates to media tile", async ({ page }) => {
    // Validates that source_url from the upload response round-trips into the
    // rendered MediaTile img src (the same URL would flow into PreviewCard
    // when connections are selected, but preview cards require seeded DB
    // connections that aren't available in the mocked e2e environment).
    const pngBuffer = Buffer.from(VALID_PNG_HEX, "hex");
    const fileInput = page.getByTestId("media-file-input");
    await fileInput.setInputFiles({ name: "upload-preview-test.png", mimeType: "image/png", buffer: pngBuffer });

    const tile = page.getByTestId("media-tile-0");
    await expect(tile).toBeVisible({ timeout: 10_000 });

    const img = tile.locator("img");
    await expect(img).toBeVisible({ timeout: 5_000 });
    const src = await img.getAttribute("src");
    expect(src).toBe(MOCK_MEDIA_URL);
  });
});
