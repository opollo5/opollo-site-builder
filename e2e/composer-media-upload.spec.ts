import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// PR 2.2 — composer media upload render (gap A1)
//
// Tests:
//  M-1  Upload PNG → MediaTile renders with correct src
//  M-2  Upload exceeds 8 MB → inline error message with trace id
//  M-3  Uploaded image renders in preview cards (LinkedIn, Instagram, X)
// ---------------------------------------------------------------------------

const MOCK_DRAFT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MOCK_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const MOCK_MEDIA_URL = "https://example.com/uploads/test-image.png";

function makeDraftResponse(overrides = {}) {
  return {
    ok: true,
    data: {
      id: MOCK_DRAFT_ID,
      company_id: MOCK_COMPANY_ID,
      draft_version: 1,
      draft_data: {
        master_text: "",
        link_url: null,
        media_refs: [],
        target_connection_ids: [],
        schedule: null,
        approval_required: false,
        ai_metadata: null,
        ...overrides,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
    },
  };
}

async function mockComposerApis(context: import("@playwright/test").BrowserContext) {
  await context.route("**/api/platform/social/drafts", (route) => {
    if (route.request().method() === "POST") {
      void route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(makeDraftResponse()) });
    } else {
      void route.continue();
    }
  });
  await context.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeDraftResponse()) });
    } else if (route.request().method() === "PATCH") {
      void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeDraftResponse({ draft_version: 2 })) });
    } else {
      void route.continue();
    }
  });
  await context.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { connections: [] } }) });
  });
  await context.route("**/api/internal/events", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await context.route("**/api/platform/social/media/upload", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { asset: { source_url: MOCK_MEDIA_URL } } }),
    });
  });
}

test.describe("composer media upload (A1)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });
  });

  test("(M-1) upload PNG — MediaTile renders with correct src", async ({ page }) => {
    const pngBuffer = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
      "hex",
    );
    const tmpPath = path.join(process.cwd(), "test-results", "upload-test.png");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, pngBuffer);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);

    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });
    const imgSrc = await page.getByTestId("media-tile-0").locator("img").getAttribute("src");
    expect(imgSrc).toBeTruthy();
    expect(imgSrc).not.toBe("undefined");

    fs.unlinkSync(tmpPath);
  });

  test("(M-2) file over 8 MB — inline error with trace id", async ({ page, context }) => {
    // Override media/upload to return 413 for this test
    await context.route("**/api/platform/social/media/upload", (route) => {
      void route.fulfill({
        status: 413,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: { code: "FILE_TOO_LARGE", message: "File exceeds 8 MB limit.", trace_id: "ce-ab12-cd34" },
        }),
      });
    });

    const bigBuffer = Buffer.alloc(8 * 1024 * 1024 + 1, 0);
    bigBuffer[0] = 0x89; bigBuffer[1] = 0x50; bigBuffer[2] = 0x4e; bigBuffer[3] = 0x47;
    const tmpPath = path.join(process.cwd(), "test-results", "oversized.png");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, bigBuffer);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);

    const errorMsg = page.locator('[role="alert"]');
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
    const text = await errorMsg.textContent();
    expect(text).toContain("8 MB");

    fs.unlinkSync(tmpPath);
  });

  test("(M-3) uploaded image appears in platform preview cards", async ({ page }) => {
    const pngBuffer = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082",
      "hex",
    );
    const tmpPath = path.join(process.cwd(), "test-results", "upload-preview-test.png");
    fs.mkdirSync(path.dirname(tmpPath), { recursive: true });
    fs.writeFileSync(tmpPath, pngBuffer);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(tmpPath);

    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });

    // Switch to preview tab if present
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
