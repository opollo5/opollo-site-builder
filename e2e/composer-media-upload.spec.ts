import { test, expect } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// PR 2.2 — composer media upload render (gap A1)
//
// Tests:
//  M-1  Upload PNG → MediaTile renders with correct src
//  M-2  Upload exceeds 8 MB → inline client-side error containing "8 MB"
//  M-3  Uploaded image appears in platform preview cards
// ---------------------------------------------------------------------------

const MOCK_DRAFT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MOCK_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const MOCK_MEDIA_URL = "https://example.com/uploads/test-image.png";

// Minimal valid 1×1 PNG (67 bytes)
const VALID_PNG_HEX =
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
  "0000000a49444154789c6260000000020001e221bc330000000049454e44ae426082";

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

  test("(M-3) uploaded image appears in platform preview cards", async ({ page }) => {
    const pngBuffer = Buffer.from(VALID_PNG_HEX, "hex");
    const fileInput = page.getByTestId("media-file-input");
    await fileInput.setInputFiles({ name: "upload-preview-test.png", mimeType: "image/png", buffer: pngBuffer });

    await expect(page.getByTestId("media-tile-0")).toBeVisible({ timeout: 10_000 });

    // Switch to preview tab if present
    const previewTab = page.locator('[data-testid="preview-tab"]');
    if (await previewTab.isVisible()) {
      await previewTab.click();
    }

    // At least one preview card should have an img with a non-empty src
    const previewImg = page.locator('[data-testid="preview-card"] img').first();
    await expect(previewImg).toBeVisible({ timeout: 5_000 });
    const src = await previewImg.getAttribute("src");
    expect(src).toBeTruthy();
    expect(src).not.toBe("undefined");
  });
});
