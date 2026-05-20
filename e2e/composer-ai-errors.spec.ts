import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// Phase 2.4 — AI assistant structured error + client_errors logging (A3)
//
// Tests AiPanel error states: rate limit (429), timeout, success.
// All API routes mocked at the browser context level — no real Anthropic
// calls are made. The composer is opened via ?compose=new on /company/social/posts.
// ---------------------------------------------------------------------------

const MOCK_DRAFT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MOCK_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function makeDraftResponse() {
  return {
    ok: true,
    data: {
      id: MOCK_DRAFT_ID,
      company_id: MOCK_COMPANY_ID,
      draft_version: 1,
      draft_data: { master_text: "", link_url: null, media_refs: [], target_connection_ids: [], schedule: null, approval_required: false, ai_metadata: null },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      archived_at: null,
    },
  };
}

async function setupComposerMocks(context: import("@playwright/test").BrowserContext) {
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
      void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(makeDraftResponse()) });
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
  // Absorb client_errors logging (fire-and-forget)
  await context.route("**/api/errors", (route) => {
    void route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, data: { trace_id: "ce-test-0000" } }) });
  });
}

async function openComposer(page: import("@playwright/test").Page) {
  await page.goto("/company/social/posts?compose=new");
  await expect(page.getByRole("dialog", { name: /new post/i })).toBeVisible({ timeout: 15_000 });
}

async function openAiPanel(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /ai assistant/i }).click();
  await expect(page.getByTestId("ai-panel")).toBeVisible({ timeout: 5_000 });
}

test.describe("AI assistant error states (A3)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsCompanyAdmin(page);
  });

  test("A3-1 — rate limit 429: shows countdown + trace_id", async ({ page, context }) => {
    await setupComposerMocks(context);

    await context.route("**/api/platform/social/cap/assist", (route) => {
      void route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "Retry-After": "30" },
        body: JSON.stringify({
          ok: false,
          error: {
            category: "rate_limit",
            code: "RATE_LIMIT",
            message: "You hit the per-minute token limit. Try again in 30s.",
            trace_id: "ai-gen-test-rl01",
            retry_after: 30,
            can_retry: true,
          },
        }),
      });
    });

    await openComposer(page);
    await openAiPanel(page);
    await page.getByTestId("ai-prompt-input").fill("Write a post about AI Act compliance");
    await page.getByTestId("ai-generate-button").click();

    await expect(page.getByTestId("ai-error-display")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("ai-trace-id")).toContainText("ai-gen-test-rl01");
    await expect(page.getByTestId("ai-error-display")).toContainText(/rate.limit|token limit/i);
  });

  test("A3-2 — timeout: shows timeout message + trace_id", async ({ page, context }) => {
    await setupComposerMocks(context);

    await context.route("**/api/platform/social/cap/assist", (route) => {
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          error: {
            category: "timeout",
            code: "TIMEOUT",
            message: "Generation timed out. Try shortening your prompt.",
            trace_id: "ai-gen-test-to01",
            can_retry: true,
          },
        }),
      });
    });

    await openComposer(page);
    await openAiPanel(page);
    await page.getByTestId("ai-prompt-input").fill("A very long test prompt");
    await page.getByTestId("ai-generate-button").click();

    await expect(page.getByTestId("ai-error-display")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("ai-trace-id")).toContainText("ai-gen-test-to01");
    await expect(page.getByTestId("ai-error-display")).toContainText(/timeout|timed out/i);
  });

  test("A3-3 — success: generated text appears in result area", async ({ page, context }) => {
    await setupComposerMocks(context);

    await context.route("**/api/platform/social/cap/assist", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { text: "Playwright e2e generated post content." },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    await openComposer(page);
    await openAiPanel(page);
    await page.getByTestId("ai-prompt-input").fill("Write about MSP market growth");
    await page.getByTestId("ai-generate-button").click();

    await expect(page.getByTestId("ai-result")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("ai-result")).toContainText("Playwright e2e generated post content.");

    // "Use this text" inserts into the composer textarea and closes the panel
    await page.getByRole("button", { name: /use this text/i }).click();
    await expect(page.getByTestId("ai-panel")).not.toBeVisible();
  });
});
