import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

// ---------------------------------------------------------------------------
// PR 2.2 — composer media upload render (gap A1)
//
// Tests:
//  M-1  Upload PNG → MediaTile renders with correct src
//  M-2  Upload exceeds 8 MB → inline error message with trace id
//  M-3  Uploaded image renders in preview cards (LinkedIn, Instagram, X)
// ---------------------------------------------------------------------------

test.describe("composer media upload (A1)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  });

  test("(M-1) upload PNG — MediaTile renders with correct src", async ({ page }) => {
    // Create a minimal valid PNG (1×1 pixel) in memory
    const pngBuffer = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900000" +
      "00a49444154789c6260000000020001e221bc330000000049454e44ae426082",
      "hex",
    );
    const tmpPath = path.join(process.cwd(), "test-results", "upload-test.png");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, pngBuffer);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);

    // MediaTile should appear after upload completes
    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });
    const imgSrc = await page.getByTestId("media-tile-0").locator("img").getAttribute("src");
    expect(imgSrc).toBeTruthy();
    expect(imgSrc).not.toBe("undefined");

    fs.unlinkSync(tmpPath);
  });

  test("(M-2) file over 8 MB — inline error with trace id", async ({ page }) => {
    // Create a buffer that's just over 8 MB
    const bigBuffer = Buffer.alloc(8 * 1024 * 1024 + 1, 0);
    // Give it a PNG header so the MIME type check passes
    bigBuffer[0] = 0x89; bigBuffer[1] = 0x50; bigBuffer[2] = 0x4e; bigBuffer[3] = 0x47;
    const tmpPath = path.join(process.cwd(), "test-results", "oversized.png");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, bigBuffer);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);

    // Error message should appear
    const errorMsg = page.locator('[role="alert"]');
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    const text = await errorMsg.textContent();
    expect(text).toContain("8 MB");
    expect(text).toMatch(/trace:/i);

    fs.unlinkSync(tmpPath);
  });

  test("(M-3) uploaded image appears in platform preview cards", async ({ page }) => {
    const pngBuffer = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900000" +
      "00a49444154789c6260000000020001e221bc330000000049454e44ae426082",
      "hex",
    );
    const tmpPath = path.join(process.cwd(), "test-results", "upload-preview-test.png");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, pngBuffer);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);

    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });

    // Switch to preview tab if not already visible
    const previewTab = page.locator('[data-testid="preview-tab"]');
    if (await previewTab.isVisible()) {
      await previewTab.click();
    }

    // At least one preview card should have an img with a non-undefined src
    const previewImg = page.locator('[data-testid="preview-card"] img').first();
    await expect(previewImg).toBeVisible({ timeout: 5_000 });
    const src = await previewImg.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).not.toBe("undefined");

    fs.unlinkSync(tmpPath);
  });
});
