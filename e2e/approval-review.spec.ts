import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// PR S1-7 — Approval review page E2E tests
//
// Public route — no signInAsCompanyAdmin needed. Token IS the auth.
//
// Gate patterns (social-01 spec S1-7):
//   "invalid token rejected", "expired token shown",
//   "form rendered for open request", "approve decision", "reject decision"
//
// NOTE: Tests that require a live DB row (valid open request) are marked
// test.fixme. They need a seed helper that inserts a real
// social_approval_recipients + social_approval_requests row with
// a known raw token. Track: TODO add seed helper for approval e2e.
// ---------------------------------------------------------------------------

const INVALID_FORMAT_TOKEN = "not-a-token";
const VALID_FORMAT_NONEXISTENT = "a".repeat(64);

test.describe("approval review page — invalid / expired states", () => {
  test("(A-1) malformed token shows invalid-link panel", async ({ page }) => {
    await page.goto(`/approve/${INVALID_FORMAT_TOKEN}`);
    const heading = page.getByRole("heading", { name: /approval link not valid/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test("(A-2) valid-format non-existent token shows invalid-link panel", async ({ page }) => {
    await page.goto(`/approve/${VALID_FORMAT_NONEXISTENT}`);
    const heading = page.getByRole("heading", { name: /approval link not valid/i });
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("approval review page — decision form (requires seed data)", () => {
  // These tests need a real DB row: social_approval_recipients row with
  // a known raw token, linked to an open social_approval_requests row.
  // TODO: add signApprovalSeed(page) helper to e2e/helpers.ts, then remove fixme.

  test.fixme(
    "(A-3) valid token renders post snapshot and decision form",
    async ({ page }) => {
      // When seed is available:
      // const { token } = await seedOpenApprovalRequest();
      // await page.goto(`/approve/${token}`);
      // await expect(page.getByTestId("approval-snapshot")).toBeVisible();
      // await expect(page.getByTestId("approval-decision-form")).toBeVisible();
      // await expect(page.getByTestId("approval-decision-approved")).toBeVisible();
      // await expect(page.getByTestId("approval-decision-rejected")).toBeVisible();
      // await expect(page.getByTestId("approval-decision-changes_requested")).toBeVisible();
    },
  );

  test.fixme(
    "(A-4) approve button records decision and shows confirmation panel",
    async ({ page, context }) => {
      // When seed is available:
      // const { token } = await seedOpenApprovalRequest();
      // await context.route(`**/api/approve/${token}/decision`, async (route) => {
      //   await route.fulfill({ status: 200, contentType: "application/json",
      //     body: JSON.stringify({ ok: true, data: { finalised: true, postId: "uuid" }, timestamp: new Date().toISOString() }) });
      // });
      // await page.goto(`/approve/${token}`);
      // await page.getByTestId("approval-decision-approved").click();
      // await expect(page.getByTestId("approval-decision-done")).toBeVisible({ timeout: 5_000 });
    },
  );

  test.fixme(
    "(A-5) already-decided request shows already-resolved panel without form",
    async ({ page }) => {
      // When seed is available:
      // const { token } = await seedFinalisedApprovalRequest();
      // await page.goto(`/approve/${token}`);
      // await expect(page.getByTestId("approval-already-decided")).toBeVisible();
      // await expect(page.getByTestId("approval-decision-form")).not.toBeVisible();
    },
  );
});

test.describe("POST /api/approve/[token]/decision — API contract", () => {
  test("(A-6) malformed token returns 404", async ({ page }) => {
    const res = await page.request.post(
      `/api/approve/${INVALID_FORMAT_TOKEN}/decision`,
      {
        data: { decision: "approved" },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status()).toBe(404);
  });

  test("(A-7) missing decision field returns 400", async ({ page }) => {
    const res = await page.request.post(
      `/api/approve/${VALID_FORMAT_NONEXISTENT}/decision`,
      {
        data: { comment: "looks good" },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status()).toBe(400);
  });

  test("(A-8) invalid decision value returns 400", async ({ page }) => {
    const res = await page.request.post(
      `/api/approve/${VALID_FORMAT_NONEXISTENT}/decision`,
      {
        data: { decision: "maybe" },
        headers: { "Content-Type": "application/json" },
      },
    );
    expect(res.status()).toBe(400);
  });
});
