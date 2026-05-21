import { expect, test } from "@playwright/test";

import { signInAsCompanyAdmin, mockComposerApis } from "./helpers";

// ---------------------------------------------------------------------------
// PR-C2 — Composer right-pane calendar month grid
//
// (CMG-1) Clicking the Calendar tab shows the MonthCalendar component.
// (CMG-2) MonthCalendar fetches posts via calendar-view API and shows a
//         PostChip for a scheduled post on the correct date.
// (CMG-3) Prev/Next month navigation updates the displayed month.
// ---------------------------------------------------------------------------

const TODAY = new Date();
const THIS_YEAR = TODAY.getFullYear();
const THIS_MONTH = TODAY.getMonth();

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const SCHEDULED_DATE = isoDate(THIS_YEAR, THIS_MONTH, 15);

const MOCK_POSTS = [
  {
    id: "post-cal-001",
    state: "scheduled",
    scheduled_at: `${SCHEDULED_DATE}T09:00:00Z`,
    published_at: null,
    content_excerpt: "Test post",
    primary_media_url: null,
    target_profiles: [{ platform: "instagram", account_avatar_url: "" }],
    is_recurring_child: false,
  },
];

test.describe("composer calendar month grid (C2)", () => {
  test("(CMG-1) Calendar tab renders MonthCalendar", async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });

    await context.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { posts: [], range: { from: "", to: "" } } }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    // Switch to Calendar tab
    await page.getByRole("button", { name: "Calendar" }).click();

    await expect(page.getByTestId("month-calendar")).toBeVisible({ timeout: 5_000 });
  });

  test("(CMG-2) scheduled post appears as PostChip on correct date", async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });

    await context.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { posts: MOCK_POSTS, range: { from: "", to: "" } },
        }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByTestId("month-calendar")).toBeVisible({ timeout: 5_000 });

    // Day cell for the 15th should contain a PostChip
    const dayCell = page.getByTestId(`calendar-day-${SCHEDULED_DATE}`);
    await expect(dayCell).toBeVisible();
    await expect(dayCell.getByTestId("post-chip")).toBeVisible();
  });

  test("(CMG-3) Prev/Next month navigation changes the header", async ({ page, context }) => {
    await signInAsCompanyAdmin(page);
    await mockComposerApis(context);

    await context.route("**/api/platform/social/connections**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { connections: [] } }),
      });
    });

    await context.route("**/api/platform/social/drafts/calendar-view**", (route) => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data: { posts: [], range: { from: "", to: "" } } }),
      });
    });

    await page.goto("/company/social/posts?compose=new");
    await page.waitForSelector('[data-testid="composer-overlay"]', { timeout: 15_000 });

    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByTestId("month-calendar")).toBeVisible({ timeout: 5_000 });

    // Navigate to next month
    await page.getByLabel("Next month").click();

    const nextMonth = new Date(THIS_YEAR, THIS_MONTH + 1, 1);
    const nextMonthName = nextMonth.toLocaleString("en-AU", { month: "long" });
    const nextMonthYear = nextMonth.getFullYear().toString();

    await expect(page.getByTestId("month-calendar")).toContainText(nextMonthName);
    await expect(page.getByTestId("month-calendar")).toContainText(nextMonthYear);
  });
});
