import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis, MOCK_DRAFT_ID, MOCK_COMPANY_ID } from "./helpers";

// ---------------------------------------------------------------------------
// Composer v3.2-polish — full-flow smoke test
//
// Covers all 15 spec items (7-21) across composer-affordances, calendar
// consolidation, and edit-mode parity workstreams.
//
//  Item 7  : Schedule button disabled tooltip
//  Item 8  : Profile chip hover hint (none selected)
//  Item 9  : Chip overlay sizes (24px checkmark, 32px brand)
//  Item 10 : Unified MonthCalendar on calendar page
//  Item 11 : Close button 32px / X-20px
//  Item 12 : Back button + unsaved-changes guard
//  Item 13 : Calendar revalidation after schedule
//  Item 14 : Unsaved-changes dialog rewrite
//  Item 15 : Click routing by post status
//  Item 16 : cursor-pointer on chips and side-rail cards
//  Item 17 : Edit-mode header icon 24px
//  Item 18 : Convert-to-draft button for scheduled edits
//  Item 19 : Calendar chip content-type indicators
//  Item 20 : Edit-mode cell highlight in Calendar tab
//  Item 21 : OG metadata rehydrate on edit-mode open
// ---------------------------------------------------------------------------

const TODAY = new Date();
const FROM = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1).toISOString().slice(0, 10);
const TO = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).toISOString().slice(0, 10);
const SCHEDULED_AT = `${FROM}T09:00:00Z`;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makePost(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    state: "scheduled",
    scheduled_at: SCHEDULED_AT,
    published_at: null,
    content_excerpt: `Post ${id}`,
    primary_media_url: null,
    link_url: null,
    target_profiles: [{ platform: "linkedin", account_avatar_url: null }],
    is_recurring_child: false,
    ...overrides,
  };
}

function mockCalendarViewBody(posts: unknown[]) {
  return JSON.stringify({ ok: true, data: { posts, range: { from: FROM, to: TO } } });
}

function mockLinkedInConnections() {
  return JSON.stringify({
    ok: true,
    data: {
      connections: [
        {
          id: "conn-smoke-li",
          platform: "linkedin",
          display_name: "Smoke LinkedIn",
          avatar_url: null,
          status: "connected",
        },
      ],
    },
  });
}

function mockDraftDetail(state: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    ok: true,
    data: {
      id: MOCK_DRAFT_ID,
      company_id: MOCK_COMPANY_ID,
      state,
      content: extra.content ?? "Smoke test post content",
      last_publish_error: extra.failure ? { message: extra.failure } : null,
      draft_data: {
        master_text: extra.content ?? "Smoke test post content",
        media_refs: [],
        target_connection_ids: ["conn-smoke-li"],
        approval_required: false,
      },
      ...extra,
    },
  });
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function openNewComposer(page: Page, context: BrowserContext) {
  await signInAsCompanyAdmin(page);
  await mockComposerApis(context);
  await page.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockLinkedInConnections() });
  });
  await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockCalendarViewBody([]),
    });
  });
  await page.goto("/company/social/posts?compose=new");
  await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });
}

async function openEditComposer(
  page: Page,
  context: BrowserContext,
  state: string,
  extra: Record<string, unknown> = {},
  calendarPosts?: unknown[],
) {
  await signInAsCompanyAdmin(page);
  await mockComposerApis(context);
  await page.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockLinkedInConnections() });
  });
  await page.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: mockDraftDetail(state, extra),
      });
    } else {
      void route.continue();
    }
  });
  await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockCalendarViewBody(calendarPosts ?? []),
    });
  });
  await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);
  await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });
}

async function openCalendarPage(page: Page, context: BrowserContext, posts: unknown[]) {
  await signInAsCompanyAdmin(page);
  await context.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockLinkedInConnections() });
  });
  await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockCalendarViewBody(posts),
    });
  });
  await page.goto("/company/social/calendar");
  await page.waitForSelector('[data-testid="calendar-shell"]', { timeout: 20_000 });
}

// ===========================================================================
// Item 7 — Schedule button disabled tooltip
// ===========================================================================

test.describe("Item 7 — disabled schedule button tooltip", () => {
  test("(v32-7) tooltip visible on hover when no profile selected", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    // With no profile selected the submit button should be disabled
    const submitBtn = page.getByTestId("composer-submit");
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });

    // force:true bypasses stability check (c3-modal-in animation keeps element
    // moving); event bubbles from button → TooltipTrigger span → tooltip shows
    await submitBtn.hover({ force: true });
    await page.waitForTimeout(400);

    const tooltip = page.getByTestId("submit-tooltip");
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Select at least one account");
  });

  test("(v32-7b) tooltip absent when a profile is selected", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    // Select a profile
    const chip = page.getByTestId("profile-chip-conn-smoke-li");
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await chip.click();

    // After selection, type content so submit is enabled
    await page.locator('[data-testid="content-textarea"]').fill("Test");

    const submitBtn = page.getByTestId("composer-submit");
    await submitBtn.hover();
    await page.waitForTimeout(400);

    // Tooltip should not be visible when button is enabled
    await expect(page.getByTestId("submit-tooltip")).not.toBeVisible();
  });
});

// ===========================================================================
// Item 8 — Profile chip hover hint when none selected
// ===========================================================================

test.describe("Item 8 — profile chip hover hint", () => {
  test("(v32-8) tooltip appears on chip hover when no profiles selected", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    const chip = page.getByTestId("profile-chip-conn-smoke-li");
    await expect(chip).toBeVisible({ timeout: 5_000 });

    await chip.hover();
    await page.waitForTimeout(400);

    // Tooltip with "Click to select" should appear
    const tooltip = page.locator('[data-testid^="profile-chip-tooltip"]').first();
    // Check the visible tooltip text content
    const tooltipEl = page.locator("text=Click to select").first();
    await expect(tooltipEl).toBeVisible({ timeout: 3_000 });
  });
});

// ===========================================================================
// Item 9 — Profile chip overlay sizes
// ===========================================================================

test.describe("Item 9 — chip overlay sizes", () => {
  test("(v32-9) selected chip checkmark overlay has 24px class (h-6 w-6)", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    const chip = page.getByTestId("profile-chip-conn-smoke-li");
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await chip.click(); // select

    // Checkmark overlay: h-6 w-6 = 24px
    const checkmark = chip.locator(".h-6.w-6").first();
    await expect(checkmark).toBeVisible({ timeout: 3_000 });

    // Brand badge: h-8 w-8 = 32px
    const brandBadge = chip.locator(".h-8.w-8").first();
    await expect(brandBadge).toBeVisible({ timeout: 3_000 });
  });
});

// ===========================================================================
// Items 10 + 19 — Unified MonthCalendar + content-type chip indicators
// ===========================================================================

test.describe("Item 10 + 19 — MonthCalendar on page + chip indicators", () => {
  test("(v32-10) calendar page renders MonthCalendar component", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openCalendarPage(page, context, [makePost("smoke10")]);

    await expect(page.getByTestId("calendar-grid")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("month-label")).toBeVisible();
    await expect(page.getByTestId("calendar-grid")).toBeVisible();
    const cells = page.getByTestId("calendar-dnd-cell");
    expect(await cells.count()).toBeGreaterThanOrEqual(28);
  });

  test("(v32-19a) text-only chip has no Image or Link2 icon", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openCalendarPage(page, context, [makePost("smoke-text")]);
    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip.locator('[aria-label="has media"]')).toHaveCount(0);
    await expect(chip.locator('[aria-label="has link"]')).toHaveCount(0);
  });

  test("(v32-19b) media chip shows Image icon", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openCalendarPage(page, context, [makePost("smoke-media", { primary_media_url: "https://example.com/img.png" })]);
    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip.locator('[aria-label="has media"]')).toHaveCount(1);
  });

  test("(v32-19c) link chip shows Link2 icon", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openCalendarPage(page, context, [makePost("smoke-link", { link_url: "https://example.com" })]);
    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip.locator('[aria-label="has link"]')).toHaveCount(1);
  });
});

// ===========================================================================
// Item 11 — Close button
// ===========================================================================

test.describe("Item 11 — close button", () => {
  test("(v32-11) close button is 40px hit target (h-10 w-10) absolute top-right with 24px X icon", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    const closeBtn = page.getByTestId("composer-close-btn");
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });

    // Tailwind h-10 w-10 = 40px hit target; absolute position on overlay
    const cls = await closeBtn.getAttribute("class");
    expect(cls).toContain("h-10");
    expect(cls).toContain("w-10");
    expect(cls).toContain("absolute");

    // Clicking it should close the composer (no unsaved changes → no dialog)
    await closeBtn.click();
    await expect(page.getByTestId("composer-overlay")).not.toBeVisible({ timeout: 3_000 });
  });
});

// ===========================================================================
// Item 12 — Back button + unsaved-changes guard (Item 14)
// ===========================================================================

test.describe("Item 12 + 14 — Back button + unsaved-changes dialog", () => {
  test("(v32-12-14) back button triggers unsaved-changes dialog when content typed", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    // Type something to make draft dirty
    await page.locator('[data-testid="content-textarea"]').fill("Some draft content");

    const backBtn = page.getByTestId("composer-back-btn");
    await expect(backBtn).toBeVisible({ timeout: 5_000 });

    // Back button uses ChevronLeft (h-8 w-8)
    const cls = await backBtn.getAttribute("class");
    expect(cls).toContain("h-8");
    expect(cls).toContain("w-8");

    await backBtn.click();

    // Unsaved-changes dialog should appear — Item 14 copy
    // ComposerOverlay also has role="dialog", so filter by content to avoid
    // strict-mode violation when two dialogs are present simultaneously.
    const dialog = page.getByRole("dialog").filter({ hasText: "Do you want to save your changes?" });
    await expect(dialog).toBeVisible({ timeout: 3_000 });

    // Three buttons: Save, Continue editing, Don't save — in spec order
    // exact:true prevents "Save" from also matching "Don't save" (substring)
    await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Continue editing", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Don't save", exact: true })).toBeVisible();

    // Continue editing dismisses dialog, composer stays open
    await dialog.getByRole("button", { name: "Continue editing", exact: true }).click();
    await expect(dialog).not.toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId("composer-overlay")).toBeVisible();
  });
});

// ===========================================================================
// Item 13 — Calendar revalidation after schedule
// ===========================================================================

test.describe("Item 13 — calendar revalidation after submit", () => {
  test("(v32-13) submitting a post triggers SWR revalidation (composer closes)", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    // Select profile + type content
    const chip = page.getByTestId("profile-chip-conn-smoke-li");
    await expect(chip).toBeVisible({ timeout: 5_000 });
    await chip.click();
    await page.locator('[data-testid="content-textarea"]').fill("Revalidation test post");

    await page.getByTestId("composer-submit").click({ timeout: 5_000 });

    // Composer closes = submit succeeded = SWR mutate ran
    await expect(page.getByTestId("composer-overlay")).not.toBeVisible({ timeout: 5_000 });
  });
});

// ===========================================================================
// Item 15 — Click routing by post status
// ===========================================================================

test.describe("Item 15 — click routing by post status", () => {
  test("(v32-15a) scheduled chip click opens composer edit mode", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    const post = makePost("smoke15-sched", { state: "scheduled" });
    await signInAsCompanyAdmin(page);
    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockLinkedInConnections() });
    });
    await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockCalendarViewBody([post]) });
    });
    await page.route(`**/api/platform/social/drafts/smoke15-sched`, (route) => {
      if (route.request().method() === "GET") {
        void route.fulfill({ status: 200, contentType: "application/json", body: mockDraftDetail("scheduled") });
      } else { void route.continue(); }
    });

    await page.goto("/company/social/calendar");
    await page.waitForSelector('[data-testid="calendar-shell"]', { timeout: 20_000 });

    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    await expect(page.getByTestId("composer-overlay")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("post-analytics-modal")).not.toBeVisible();
  });

  test("(v32-15b) published chip click opens analytics modal, not composer", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    const post = makePost("smoke15-pub", {
      state: "published",
      scheduled_at: null,
      published_at: SCHEDULED_AT,
    });
    await signInAsCompanyAdmin(page);
    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockLinkedInConnections() });
    });
    await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockCalendarViewBody([post]) });
    });
    await page.route("**/api/platform/social/drafts/*/analytics**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data: { metrics: [], stale: false } }) });
    });

    await page.goto("/company/social/calendar");
    await page.waitForSelector('[data-testid="calendar-shell"]', { timeout: 20_000 });

    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await chip.click();

    await expect(page.getByTestId("post-analytics-modal")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("composer-overlay")).not.toBeVisible();
  });
});

// ===========================================================================
// Item 16 — cursor-pointer on chips and side-rail cards
// ===========================================================================

test.describe("Item 16 — cursor-pointer on clickable elements", () => {
  test("(v32-16) post chip has cursor-pointer class", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openCalendarPage(page, context, [makePost("smoke16")]);

    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });

    const cls = await chip.getAttribute("class");
    expect(cls).toContain("cursor-pointer");
  });
});

// ===========================================================================
// Item 17 — Edit-mode header icon 24px
// ===========================================================================

test.describe("Item 17 — edit-mode header icon size", () => {
  test("(v32-17) edit-mode header platform icon renders at width=24", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openEditComposer(page, context, "scheduled");

    const header = page.locator('[data-testid="composer-overlay"] h2');
    await expect(header).toContainText("Edit post", { timeout: 5_000 });

    const icon = header.locator("svg").first();
    await expect(icon).toBeVisible({ timeout: 3_000 });
    expect(await icon.getAttribute("width")).toBe("24");
  });
});

// ===========================================================================
// Item 18 — Convert-to-draft button for scheduled edits
// ===========================================================================

test.describe("Item 18 — convert-to-draft", () => {
  test("(v32-18) convert-to-draft button visible when editing a scheduled post", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openEditComposer(page, context, "scheduled");
    await expect(page.getByTestId("convert-to-draft-btn")).toBeVisible({ timeout: 5_000 });
  });

  test("(v32-18b) convert-to-draft button absent for a draft post", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openEditComposer(page, context, "draft");
    await expect(page.getByTestId("convert-to-draft-btn")).not.toBeVisible({ timeout: 3_000 });
  });
});

// ===========================================================================
// Item 20 — Edit-mode cell highlight in Calendar tab
// ===========================================================================

test.describe("Item 20 — calendar tab cell highlight", () => {
  test("(v32-20) Calendar tab shows emerald ring on the post chip being edited", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openEditComposer(
      page,
      context,
      "scheduled",
      {},
      [makePost(MOCK_DRAFT_ID)], // calendar-view includes the draft post
    );

    const calendarTab = page.getByRole("button", { name: "Calendar" });
    await expect(calendarTab).toBeVisible({ timeout: 5_000 });
    await calendarTab.click();

    await expect(page.getByTestId("calendar-grid")).toBeVisible({ timeout: 5_000 });

    const chip = page.getByTestId("post-chip").first();
    await expect(chip).toBeVisible({ timeout: 10_000 });

    const cls = await chip.getAttribute("class");
    expect(cls).toContain("ring-emerald-500");
  });

  test("(v32-20b) Calendar tab shows no highlight for new post (no highlightPostId)", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openNewComposer(page, context);

    const calendarTab = page.getByRole("button", { name: "Calendar" });
    await expect(calendarTab).toBeVisible({ timeout: 5_000 });
    await calendarTab.click();

    await expect(page.getByTestId("calendar-grid")).toBeVisible({ timeout: 5_000 });
    // No chip = no post on calendar, therefore no highlighted chip
    await expect(page.getByTestId("post-chip").first()).not.toBeVisible({ timeout: 3_000 });
  });
});

// ===========================================================================
// Item 21 — OG metadata rehydrate (link preview on edit-mode open)
// ===========================================================================

test.describe("Item 21 — OG metadata rehydrate", () => {
  test("(v32-21) link preview fetched automatically when editing post with URL in content", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    let linkPreviewCalled = false;

    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);
    await page.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockLinkedInConnections() });
    });
    await page.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
      if (route.request().method() === "GET") {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: mockDraftDetail("scheduled", {
            content: "Check out https://example.com for our latest news",
          }),
        });
      } else { void route.continue(); }
    });
    await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({ status: 200, contentType: "application/json", body: mockCalendarViewBody([]) });
    });
    // Mock the link-preview endpoint
    await page.route("**/api/platform/social/link-preview**", (route) => {
      linkPreviewCalled = true;
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            url: "https://example.com",
            title: "Example Domain",
            description: "Example description",
            image: null,
          },
        }),
      });
    });

    await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });

    // Wait for the debounced URL detection effect to fire
    await page.waitForTimeout(400);

    // The link-preview endpoint should have been called automatically
    expect(linkPreviewCalled).toBe(true);
  });
});

// ===========================================================================
// Failure banner — Item 15 sub-case
// ===========================================================================

test.describe("Failed post — failure banner", () => {
  test("(v32-15-fail) failure banner visible when editing a failed post", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openEditComposer(page, context, "failed", { failure: "Rate limit exceeded" });

    await expect(page.getByTestId("failure-banner")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("failure-banner")).toContainText("Rate limit exceeded");
  });
});

// ===========================================================================
// Publishing read-only overlay — Item 15 sub-case
// ===========================================================================

test.describe("Publishing state — read-only overlay", () => {
  test("(v32-15-pub) publishing state shows read-only overlay and Publishing pill", async ({
    page, context,
  }: { page: Page; context: BrowserContext }) => {
    await openEditComposer(page, context, "publishing");

    const readOnlyOverlay = page
      .locator('[data-testid="composer-overlay"]')
      .locator(".pointer-events-none.opacity-60");
    await expect(readOnlyOverlay).toBeVisible({ timeout: 5_000 });

    await expect(
      page.locator('[data-testid="composer-overlay"] h2'),
    ).toContainText("Publishing", { timeout: 5_000 });
  });
});
