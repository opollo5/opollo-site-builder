import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// Spec: AI assistant error categorization (PR-B1)
//
// Regression guard: a 400 from the AI assist endpoint must NOT show
// "Content rejected" — it must show the "Request failed" bucket.
// Covers the BadRequestError → invalid_request fix.
//
// Tests:
//  AI-1  400 (invalid_request) response → shows "Request failed", not "Content rejected"
//  AI-2  trace_id visible in the error display
// ---------------------------------------------------------------------------

const MOCK_INVALID_REQUEST_ERROR = {
  ok: false,
  error: {
    category: "invalid_request",
    code: "INVALID_REQUEST",
    message: "Something went wrong with your request. Please try again.",
    trace_id: "ai-gen-test-1234",
    can_retry: false,
  },
};

test.describe("AI assistant error categorization (B1)", () => {
  test.beforeEach(async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    // Mock the error log endpoint to avoid noise.
    await context.route("**/api/errors", (route) => {
      void route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, data: { trace_id: "ai-gen-test-1234" } }) });
    });
  });

  test("AI-1: 400 response shows 'Request failed', not 'Content rejected'", async ({ page }) => {
    // Mock the AI assist endpoint to return a 400 invalid_request error.
    await page.route("**/api/platform/social/cap/assist", (route) => {
      void route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify(MOCK_INVALID_REQUEST_ERROR),
      });
    });

    await page.goto("/company/social/calendar?compose=new");
    const dialog = page.getByRole("dialog", { name: /new post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Open AI panel.
    const aiBtn = dialog.getByTestId("composer-tool-ai");
    await expect(aiBtn).toBeVisible({ timeout: 10_000 });
    await aiBtn.click();
    await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 5_000 });

    // Enter a prompt and click Generate.
    await page.getByTestId("ai-prompt-input").fill("Write a post about cheese");
    await page.getByTestId("ai-generate-button").click();

    // The error display must appear.
    const errorDisplay = page.getByTestId("ai-error-display");
    await expect(errorDisplay).toBeVisible({ timeout: 5_000 });

    // Must show "Request failed", NOT "Content rejected".
    await expect(errorDisplay).toContainText("Request failed");
    await expect(errorDisplay).not.toContainText("Content rejected");
  });

  test("AI-2: trace_id is visible in the error display", async ({ page }) => {
    await page.route("**/api/platform/social/cap/assist", (route) => {
      void route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify(MOCK_INVALID_REQUEST_ERROR),
      });
    });

    await page.goto("/company/social/calendar?compose=new");
    const dialog = page.getByRole("dialog", { name: /new post/i });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const aiBtn = dialog.getByTestId("composer-tool-ai");
    await expect(aiBtn).toBeVisible({ timeout: 10_000 });
    await aiBtn.click();
    await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("ai-prompt-input").fill("Write a post about cheese");
    await page.getByTestId("ai-generate-button").click();

    await expect(page.getByTestId("ai-error-display")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("ai-trace-id")).toBeVisible();
    await expect(page.getByTestId("ai-trace-id")).toContainText("ai-gen-test-1234");
  });
});
