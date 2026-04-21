import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
} from "./fixtures";

// Shared helpers for the Playwright suite.

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
