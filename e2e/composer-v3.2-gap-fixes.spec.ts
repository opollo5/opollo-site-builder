import { test, expect } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis, MOCK_DRAFT_ID, MOCK_COMPANY_ID } from "./helpers";

// ---------------------------------------------------------------------------
// Gap-fix verification tests for composer v3.2-polish items 10, 17, 20.
//
//  GAP-10  CalendarShell uses MonthCalendar — data-testid="calendar-grid"
//          appears on the page calendar view (CalendarShell delegates its
//          grid to MonthCalendar).
//
//  GAP-17  Edit-mode header platform icon is 24px (spec requirement).
//          Verify the icon element is rendered in the "Edit post for" header
//          at the correct size attribute.
//
//  GAP-20  ComposerOverlay Calendar tab passes highlightPostId to
//          MonthCalendar — the post chip for the currently-edited draft
//          receives the emerald ring class.
// ---------------------------------------------------------------------------

const TODAY = new Date();
const FROM = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1).toISOString().slice(0, 10);
const TO = new Date(TODAY.getFullYear(), TODAY.getMonth() + 1, 0).toISOString().slice(0, 10);
const SCHEDULED_AT = `${FROM}T09:00:00Z`;

function makeCalendarPost(id: string) {
  return {
    id,
    state: "scheduled",
    scheduled_at: SCHEDULED_AT,
    published_at: null,
    content_excerpt: "Gap fix test post",
    primary_media_url: null,
    link_url: null,
    target_profiles: [{ platform: "linkedin", account_avatar_url: null }],
    is_recurring_child: false,
  };
}

function mockCalendarView(posts: unknown[]) {
  return JSON.stringify({ ok: true, data: { posts, range: { from: FROM, to: TO } } });
}

function mockConnections() {
  return JSON.stringify({
    ok: true,
    data: {
      connections: [
        {
          id: "conn-gap-linkedin",
          platform: "linkedin",
          display_name: "Gap Fix LinkedIn",
          avatar_url: null,
          status: "connected",
        },
      ],
    },
  });
}

function makeDraftApiResponse() {
  return JSON.stringify({
    ok: true,
    data: {
      id: MOCK_DRAFT_ID,
      company_id: MOCK_COMPANY_ID,
      state: "scheduled",
      content: "Gap fix post content",
      last_publish_error: null,
      draft_data: {
        master_text: "Gap fix post content",
        media_refs: [],
        target_connection_ids: ["conn-gap-linkedin"],
        approval_required: false,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// GAP-10: CalendarShell delegates grid to MonthCalendar
// ---------------------------------------------------------------------------

test("(GAP-10) CalendarShell renders via MonthCalendar — calendar-grid testid visible on calendar page", async ({
  page,
  context,
}: { page: Page; context: BrowserContext }) => {
  await signInAsCompanyAdmin(page);
  await context.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
  });
  await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockCalendarView([makeCalendarPost("gap10-post")]),
    });
  });

  await page.goto("/company/social/calendar");
  await page.waitForSelector('[data-testid="calendar-shell"]', { timeout: 20_000 });

  // MonthCalendar must be rendered inside CalendarShell (gap fix: Item 10)
  await expect(page.getByTestId("calendar-grid")).toBeVisible({ timeout: 10_000 });

  // Month label, calendar grid, and a post chip should all be present
  await expect(page.getByTestId("month-label")).toBeVisible();
  await expect(page.getByTestId("calendar-grid")).toBeVisible();

  const cells = page.getByTestId("calendar-dnd-cell");
  const count = await cells.count();
  expect(count).toBeGreaterThanOrEqual(28);

  // Post chip should render (from the mocked calendar-view post)
  await expect(page.getByTestId("post-chip").first()).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// GAP-17: Edit-mode header platform icon at 24px
// ---------------------------------------------------------------------------

async function openEditModeComposer(page: Page, context: BrowserContext) {
  await signInAsCompanyAdmin(page);
  await mockComposerApis(context);
  await page.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
  });
  await page.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeDraftApiResponse(),
      });
    } else {
      void route.continue();
    }
  });
  await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);
  await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });
}

test("(GAP-17) Edit-mode header contains platform icon rendered at 24px", async ({
  page,
  context,
}: { page: Page; context: BrowserContext }) => {
  await openEditModeComposer(page, context);

  const header = page.locator('[data-testid="composer-overlay"] h2');
  await expect(header).toContainText("Edit post", { timeout: 5_000 });

  // The SocialPlatformIcon renders as an SVG; check it exists in the header
  const platformIcon = header.locator("svg").first();
  await expect(platformIcon).toBeVisible({ timeout: 3_000 });

  // Verify the icon width attribute matches 24px (SocialPlatformIcon passes size as width/height)
  const widthAttr = await platformIcon.getAttribute("width");
  expect(widthAttr).toBe("24");
});

// ---------------------------------------------------------------------------
// GAP-20: highlightPostId wired in ComposerOverlay Calendar tab
// ---------------------------------------------------------------------------

test("(GAP-20) Calendar tab highlights the post chip for the draft being edited", async ({
  page,
  context,
}: { page: Page; context: BrowserContext }) => {
  await signInAsCompanyAdmin(page);
  await mockComposerApis(context);
  await page.route("**/api/platform/social/connections**", (route) => {
    void route.fulfill({ status: 200, contentType: "application/json", body: mockConnections() });
  });
  await page.route(`**/api/platform/social/drafts/${MOCK_DRAFT_ID}`, (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: makeDraftApiResponse(),
      });
    } else {
      void route.continue();
    }
  });
  // Calendar-view returns the same draft post so MonthCalendar can render it
  await page.route("**/api/platform/social/drafts/calendar-view**", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: mockCalendarView([makeCalendarPost(MOCK_DRAFT_ID)]),
    });
  });

  await page.goto(`/company/social/posts?compose=${MOCK_DRAFT_ID}`);
  await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 20_000 });

  // Switch to Calendar tab in the right pane
  const calendarTab = page.getByRole("button", { name: "Calendar" });
  await expect(calendarTab).toBeVisible({ timeout: 5_000 });
  await calendarTab.click();

  await expect(page.getByTestId("calendar-grid")).toBeVisible({ timeout: 5_000 });

  // The chip for MOCK_DRAFT_ID should have the emerald ring (highlightPostId prop wired)
  const chip = page.getByTestId("post-chip").first();
  await expect(chip).toBeVisible({ timeout: 10_000 });

  // ring-2 ring-emerald-500 classes indicate the highlight is applied
  const chipClass = await chip.getAttribute("class");
  expect(chipClass).toContain("ring-emerald-500");
});
