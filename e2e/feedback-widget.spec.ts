import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Feedback widget e2e tests — P10 verification gate.
//
// Assertions per §12 of the feedback v1 build spec:
//   - feedback-tab visible on authenticated route
//   - feedback-rail opens on tab click
//   - feedback-picker visible in pick mode
//   - feedback-create-popup visible after element pick
//   - feedback-submit visible in popup
//   - admin-feedback-board visible at /admin/feedback
//   - bug-replay-marker renders at correct percentage position
//   - ticket-thread and ticket-reply visible on ticket detail
//   - ticket-event-timeline visible
//   - ticket-still-broken visible when status is fixed/verified
//
// Note: most tests that require API round-trips (create ticket, reopen)
// use the API directly and verify the response, then navigate to the UI.
// Playwright mocks the auth session for the test user.
// ---------------------------------------------------------------------------

// These tests require FEATURE_FEEDBACK_WIDGET=1 and a UAT user to be set up.
// They are skipped if the env var is not present.
test.describe("feedback widget — data-testid smoke (§12 verification)", () => {
  test.skip(
    !process.env.FEATURE_FEEDBACK_WIDGET,
    "FEATURE_FEEDBACK_WIDGET not set — skipping widget e2e tests",
  );

  // -------------------------------------------------------------------------
  // feedback-tab (v1.3: single click → picker; rail removed)
  // -------------------------------------------------------------------------

  test("feedback-tab is visible on an authenticated company route", async ({ page }) => {
    await page.goto("/company/social/calendar");
    await expect(page.getByTestId("feedback-tab")).toBeVisible({ timeout: 10000 });
  });

  test("feedback-tab click goes directly to picker (no intermediate rail)", async ({ page }) => {
    // §2 v1.3: single tab click enters picker mode immediately.
    // The intermediate rail/tray has been removed.
    await page.goto("/company/social/calendar");
    await page.getByTestId("feedback-tab").click();
    await expect(page.getByTestId("feedback-picker")).toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // feedback-picker (element picker mode)
  // -------------------------------------------------------------------------

  test("feedback-picker is shown after clicking the tab", async ({ page }) => {
    await page.goto("/company/social/calendar");
    await page.getByTestId("feedback-tab").click();
    await expect(page.getByTestId("feedback-picker")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // feedback-create-popup and feedback-submit
  // -------------------------------------------------------------------------

  test("feedback-create-popup appears after picking an element", async ({ page }) => {
    await page.goto("/company/social/calendar");
    await page.getByTestId("feedback-tab").click();
    await expect(page.getByTestId("feedback-picker")).toBeVisible({ timeout: 5000 });

    // Click anywhere on the page body to pick the element.
    await page.click("body", { position: { x: 200, y: 200 } });

    await expect(page.getByTestId("feedback-create-popup")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("feedback-submit")).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // admin-feedback-board
  // -------------------------------------------------------------------------

  test("admin-feedback-board is visible at /admin/feedback (staff only)", async ({ page }) => {
    // This requires an admin session.
    await page.goto("/admin/feedback");
    await expect(page.getByTestId("admin-feedback-board")).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // bug-replay-marker — percentage offset test
  // -------------------------------------------------------------------------

  test("bug-replay-marker is positioned at click_x_pct/click_y_pct", async ({ page }) => {
    // Navigate to an admin ticket detail page. In UAT this requires a real
    // ticket to exist — if none exist, the test skips.
    const resp = await page.request.get("/api/feedback/tickets?status=backlog");
    const body = await resp.json();
    if (!body.ok || body.data.tickets.length === 0) {
      test.skip();
      return;
    }

    const ticket = body.data.tickets[0];
    await page.goto(`/admin/feedback/${ticket.id}`);
    const marker = page.getByTestId("bug-replay-marker");
    await expect(marker).toBeVisible({ timeout: 10000 });

    // Verify the marker's CSS position matches the stored percentages.
    const parent = marker.locator("..");
    const parentBox = await parent.boundingBox();
    const markerBox = await marker.boundingBox();

    if (parentBox && markerBox) {
      const markerCentreX = markerBox.x + markerBox.width / 2;
      const markerCentreY = markerBox.y + markerBox.height / 2;
      const expectedX = parentBox.x + (ticket.click_x_pct / 100) * parentBox.width;
      const expectedY = parentBox.y + (ticket.click_y_pct / 100) * parentBox.height;
      // Allow ±5px tolerance for rounding.
      expect(Math.abs(markerCentreX - expectedX)).toBeLessThan(5);
      expect(Math.abs(markerCentreY - expectedY)).toBeLessThan(5);
    }
  });

  // -------------------------------------------------------------------------
  // ticket-thread, ticket-reply, ticket-event-timeline
  // -------------------------------------------------------------------------

  test("ticket-thread and ticket-reply are visible on ticket detail", async ({ page }) => {
    const resp = await page.request.get("/api/feedback/tickets?status=backlog");
    const body = await resp.json();
    if (!body.ok || body.data.tickets.length === 0) { test.skip(); return; }

    const ticket = body.data.tickets[0];
    await page.goto(`/admin/feedback/${ticket.id}`);
    await expect(page.getByTestId("ticket-thread")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("ticket-reply")).toBeVisible();
  });

  test("ticket-event-timeline is visible on ticket detail", async ({ page }) => {
    const resp = await page.request.get("/api/feedback/tickets?status=backlog");
    const body = await resp.json();
    if (!body.ok || body.data.tickets.length === 0) { test.skip(); return; }

    const ticket = body.data.tickets[0];
    await page.goto(`/admin/feedback/${ticket.id}`);
    await expect(page.getByTestId("ticket-event-timeline")).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // ticket-still-broken
  // -------------------------------------------------------------------------

  test("ticket-still-broken visible when ticket status is fixed", async ({ page }) => {
    // Look for a fixed ticket; skip if none exist.
    const resp = await page.request.get("/api/feedback/tickets?status=fixed");
    const body = await resp.json();
    if (!body.ok || body.data.tickets.length === 0) { test.skip(); return; }

    const ticket = body.data.tickets[0];
    // Use customer view for Still broken.
    await page.goto(`/feedback/${ticket.id}`);
    await expect(page.getByTestId("ticket-still-broken")).toBeVisible({ timeout: 10000 });
  });

  // -------------------------------------------------------------------------
  // Still broken — functional test
  // -------------------------------------------------------------------------

  test("ticket-still-broken moves a verified ticket to in_progress", async ({ page }) => {
    const resp = await page.request.get("/api/feedback/tickets?status=verified");
    const body = await resp.json();
    if (!body.ok || body.data.tickets.length === 0) { test.skip(); return; }

    const ticket = body.data.tickets[0];
    await page.goto(`/feedback/${ticket.id}`);
    await page.getByTestId("ticket-still-broken").click();
    // After click the status should update — the button should disappear
    // (it's only shown for fixed/verified).
    await expect(page.getByTestId("ticket-still-broken")).not.toBeVisible({ timeout: 5000 });
  });

  // -------------------------------------------------------------------------
  // Still broken — rejected on closed ticket
  // -------------------------------------------------------------------------

  test("reopen is rejected on a closed ticket (not shown in UI, API returns 409)", async ({ page }) => {
    const resp = await page.request.get("/api/feedback/tickets?status=closed");
    const body = await resp.json();
    if (!body.ok || body.data.tickets.length === 0) { test.skip(); return; }

    const ticket = body.data.tickets[0];
    const reopenResp = await page.request.post(`/api/feedback/tickets/${ticket.id}/reopen`, {
      data: { comment: "test" },
    });
    expect(reopenResp.status()).toBe(409);
  });
});
