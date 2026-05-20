import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page, TestInfo } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_CUSTOMER_EMAIL,
  E2E_CUSTOMER_PASSWORD,
} from "./fixtures";

// Shared helpers for the Playwright suite.

// ---------------------------------------------------------------------------
// Composer mock constants — used by composer-media-upload and composer-gif-attach
// ---------------------------------------------------------------------------

export const MOCK_DRAFT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
export const MOCK_COMPANY_ID = "11111111-1111-1111-1111-111111111111";
export const MOCK_MEDIA_URL = "https://example.com/uploads/test-image.png";

function makeDraftResponse(overrides: Record<string, unknown> = {}) {
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

/**
 * Install context-level route mocks for the composer overlay:
 * drafts POST/GET/PATCH, connections, events, and media/upload.
 * Override individual routes in the test body as needed (e.g., to
 * simulate a 413 from media/upload for over-size error tests).
 */
export async function mockComposerApis(context: BrowserContext): Promise<void> {
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

// ---------------------------------------------------------------------------

/**
 * Sign in as the seeded admin via the real /login form flow. Returns
 * after landing on the admin surface so callers can immediately
 * navigate further. Deliberately uses the HTML form (Server Action)
 * rather than hitting the Supabase Auth endpoint directly — the
 * point of E2E is to exercise what a real user's browser does.
 */
export async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_ADMIN_EMAIL);
  await page.getByLabel("Password").fill(E2E_ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // Default post-login redirect is /admin/sites.
  await page.waitForURL(/\/admin\/sites/);
}

/**
 * Sign in as the seeded company admin via /login?next=/company.
 * Returns after the /company landing page has loaded.
 */
export async function signInAsCompanyAdmin(page: Page): Promise<void> {
  await page.goto("/login?next=%2Fcompany");
  await page.getByLabel("Email").fill(E2E_CUSTOMER_EMAIL);
  await page.getByLabel("Password").fill(E2E_CUSTOMER_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/company/);
}

/**
 * Run axe-core against the current page and attach findings to the
 * test result. Non-blocking by default — the Level 3 roadmap calls
 * for surfacing findings in CI without failing the build so we can
 * triage them incrementally. Flip `blocking` to true on a per-test
 * basis when fixing a specific rule, or raise the whole suite's
 * severity ceiling once initial findings are cleared.
 */
export async function auditA11y(
  page: Page,
  testInfo: TestInfo,
  opts: { blocking?: boolean } = {},
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();

  if (results.violations.length === 0) return;

  const summary = results.violations
    .map(
      (v) =>
        `- ${v.id} (${v.impact ?? "unknown"}): ${v.help}\n  ${v.helpUrl}`,
    )
    .join("\n");
  await testInfo.attach("axe-violations", {
    body: `Page: ${page.url()}\n\n${summary}\n\nFull report:\n${JSON.stringify(
      results.violations,
      null,
      2,
    )}`,
    contentType: "text/plain",
  });

  if (opts.blocking) {
    throw new Error(
      `axe-core found ${results.violations.length} violation(s) on ${page.url()}. See the attached report.`,
    );
  }
  // Non-blocking: log to stderr so CI's test-summary step surfaces
  // the count without failing the suite.
  // eslint-disable-next-line no-console
  console.warn(
    `[a11y] ${results.violations.length} axe violation(s) on ${page.url()}`,
  );
}
