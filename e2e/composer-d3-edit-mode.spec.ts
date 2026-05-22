import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis, MOCK_DRAFT_ID, MOCK_COMPANY_ID } from "./helpers";

// ---------------------------------------------------------------------------
// PR-D3 — Edit-mode parity: click routing, header, failure banner,
//          convert-to-draft, publishing read-only, mapV1→V2 content fix.
//
// Tests:
//  D3-1  Clicking a scheduled chip opens composer in edit mode
//  D3-2  Clicking a published chip opens analytics modal (not composer)
//  D3-3  Header shows "Edit post for [profile]" when editing an existing draft
//  D3-4  Failure banner visible when draft state is 'failed'
//  D3-5  Convert-to-draft button visible when editing a scheduled post
//  D3-6  Publishing state disables editor content area (read-only overlay)
// ---------------------------------------------------------------------------

const TODAY = new Date();
const FROM = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1).toISOString().slice(0, 10);
const TO = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).toISOString().slice(0, 10);
const FUTURE_AT = `${FROM}T12:00:00Z`;

function makeCalendarPost(id: string, state: string) {
  return {
    id,
    state,
    scheduled_at: state === "published" ? null : FUTURE_AT,
    published_at: state === "published" ? FUTURE_AT : null,
    content_excerpt: `Post ${id} excerpt`,
    primary_media_url: null,
    link_url: null,
    target_profiles: [{ platform: "linkedin", account_avatar_url: null }],
    is_recurring_child: false,
  };
}

function mockCalendarView(posts: unknown[]) {
  return JSON.stringify({ ok: true, data: { posts, range: { from: FROM, to: TO } } });
}

function makeDraftApiResponse(state: string, failureMessage?: string) {
  return JSON.stringify({
    ok: true,
    data: {
      id: MOCK_DRAFT_ID,
      company_id: MOCK_COMPANY_ID,
      state,
      content: "Existing post content",
      last_publish_error: failureMessage ? { message: failureMessage } : null,
      draft_data: {
        master_text: "Existing post content",
        media_refs: [],
        target_connection_ids: ["conn-d3-linkedin"],
        approval_required: false,
      },
    },
  });
}

function mockConnections() {
  return JSON.stringify({
    ok: true,
    data: {
      connections: [
        {
          id: "conn-d3-linkedin",
          platform: "linkedin",
          display_name: "D3 LinkedIn",
          avatar_url: null,
          status: "connected",
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Shared setup for click-routing tests (navigate to CalendarShell)
// ---------------------------------------------------------------------------
async function setupCalendarWithPost(
  page: Page,
  context: BrowserContext,
  post: unknown,
  draftState?: string,
  failureMessage?: string,
) {
  await signInAsCompanyAdmin(page);
  await context.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
  });
  await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockCalendarView([post]),
    });
  });
  if (draftState) {
    await page.route(`**/api/platform/social/drafts/${(post as { id: string }).id}`, (route) => {
      if (route.request().method() === "GET") {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: makeDraftApiResponse(draftState, failureMessage),
        });
      } else {
        void route.continue();
      }
    });
  }
  await page.goto("/company/social/calendar");
  await page.waitForSelector('[data-testid="calendar-shell"]', { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Setup for ?compose=<id> tests (directly open edit mode)
// ---------------------------------------------------------------------------
async function setupEditModeComposer(
  page: Page,
  context: BrowserContext,
  state: string,
  failureMessage?: string,
) {
  await signInAsCompanyAdmin(page);
  await mockComposerApis(context);
  // page.route wins over context mock for connections
  await page.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
  });
  await page.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeDraftApiResponse(state, failureMessage),
      });
    } else {
      void route.continue();
    }
  });
  await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);
  await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });
}

test.describe("PR-D3 edit-mode parity", () => {
  test("(D3-1) clicking a scheduled chip opens composer in edit mode", async ({ page, context }) => {
    const post = makeCalendarPost("d3-scheduled", "scheduled");
    await setupCalendarWithPost(page, context, post, "scheduled");

    // Click the post chip
    const chip = page.locator('[data-testid="post-chip"]').first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    // Composer overlay should open (not analytics modal)
    await expect(page.getByTestId("composer-overlay")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("post-analytics-modal")).not.toBeVisible();
  });

  test("(D3-2) clicking a published chip opens analytics modal (not composer)", async ({
    page,
    context,
  }) => {
    const post = makeCalendarPost("d3-published", "published");
    // No need to mock the draft endpoint for published posts
    await signInAsCompanyAdmin(page);
    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
    });
    await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: mockCalendarView([post]),
      });
    });
    // Analytics modal fetches metrics — mock it to avoid real API calls
    await page.route("**/api/platform/social/drafts/*/analytics**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { metrics: [], stale: false } }),
      });
    });
    await page.goto("/company/social/calendar");
    await page.waitForSelector('[data-testid="calendar-shell"]', { timeout: 20_000 });

    const chip = page.locator('[data-testid="post-chip"]').first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    // Analytics modal should open; composer overlay should NOT open
    await expect(page.getByTestId("post-analytics-modal")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("composer-overlay")).not.toBeVisible();
  });

  test("(D3-3) header shows 'Edit post for' with profile name when editing", async ({
    page,
    context,
  }) => {
    await setupEditModeComposer(page, context, "scheduled");

    // Header should show "Edit post for" + profile name from the loaded draft
    const header = page.locator('[data-testid="composer-overlay"] h2');
    await expect(header).toContainText("Edit post", { timeout: 5_000 });
    await expect(header).toContainText("D3 LinkedIn");
  });

  test("(D3-4) failure banner visible when draft state is 'failed'", async ({
    page,
    context,
  }) => {
    await setupEditModeComposer(page, context, "failed", "Rate limit exceeded");

    await expect(page.getByTestId("failure-banner")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("failure-banner")).toContainText("Rate limit exceeded");
  });

  test("(D3-5) convert-to-draft button visible when editing a scheduled post", async ({
    page,
    context,
  }) => {
    await setupEditModeComposer(page, context, "scheduled");

    await expect(page.getByTestId("convert-to-draft-btn")).toBeVisible({ timeout: 5_000 });
  });

  test("(D3-6) publishing state renders editor area as read-only (pointer-events-none)", async ({
    page,
    context,
  }) => {
    await setupEditModeComposer(page, context, "publishing");

    // The left pane's content area should have opacity-60 applied (publishing read-only)
    const contentArea = page
      .locator('[data-testid="composer-overlay"]')
      .locator(".pointer-events-none.opacity-60");
    await expect(contentArea).toBeVisible({ timeout: 5_000 });

    // "Publishing…" pill should appear in the header
    await expect(
      page.locator('[data-testid="composer-overlay"] h2'),
    ).toContainText("Publishing", { timeout: 5_000 });
  });

  test("(D3-7) calendar chip click with dirty draft shows UnsavedChangesDialog", async ({
    page,
    context,
  }) => {
    await signInAsCompanyAdmin(page);
    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
    });
    await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: mockCalendarView([makeCalendarPost(MOCK_DRAFT_ID, "scheduled")]),
      });
    });
    await page.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
      if (route.request().method() === "GET") {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: makeDraftApiResponse("scheduled"),
        });
      } else {
        void route.continue();
      }
    });

    await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });

    // Make the draft dirty by editing content
    const textarea = page.getByTestId("content-textarea");
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await textarea.click();
    await textarea.fill("D3-7 dirty edit — should trigger UnsavedChangesDialog");

    // Switch to Calendar tab in the right pane
    const calendarTabBtn = page
      .locator('[data-testid="composer-overlay"]')
      .getByRole("button", { name: "Calendar" });
    await expect(calendarTabBtn).toBeVisible({ timeout: 3_000 });
    await calendarTabBtn.click();

    // Wait for the post chip to appear in the calendar view
    const chip = page.locator('[data-testid="post-chip"]').first();
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await chip.click();

    // UnsavedChangesDialog should appear
    await expect(page.getByTestId("unsaved-continue-btn")).toBeVisible({ timeout: 3_000 });

    // "Continue editing" closes the dialog and preserves content
    await page.getByTestId("unsaved-continue-btn").click();
    await expect(page.getByTestId("unsaved-continue-btn")).not.toBeVisible({ timeout: 2_000 });
    await expect(textarea).toHaveValue("D3-7 dirty edit — should trigger UnsavedChangesDialog");
  });
});
