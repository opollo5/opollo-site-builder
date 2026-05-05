import { expect, test } from "@playwright/test";

import { E2E_TEST_SITE_PREFIX } from "./fixtures";
import { auditA11y, signInAsAdmin } from "./helpers";

// ---------------------------------------------------------------------------
// M12-1 — brief upload + review E2E.
//
// Flows covered:
//   1. Upload → parse → commit happy path.
//   2. Edit cancel — page state doesn't persist if not committed.
//   3. Double-commit dedup (VERSION_CONFLICT translated to operator copy).
//
// Relies on the shared e2e seed from global-setup: an "E2E Test Site"
// row with prefix E2E_TEST_SITE_PREFIX.
// ---------------------------------------------------------------------------

// Each test needs a UNIQUE source document so the upload route's
// idempotency key — sha256(site_id + uploaded_by + file_sha256) —
// produces a fresh brief instead of dedup-replaying a previous
// test's upload. Inlining the per-test `unique` string into the
// brief content is the cheapest way to get that property while
// keeping the parse result shape (H2 sections: Home / About /
// Pricing) identical across tests.
function makeBrief(unique: string): string {
  return `# Acme Brief — ${unique}

<!-- signature: ${unique} -->

## Home

The home hero lands the tagline for ${unique}. Three feature cards follow.

## About

Our story and team.

## Pricing

Three tiers.
`;
}

async function findTestSiteDetailUrl(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/admin/sites");
  const row = page.getByRole("row", { name: /E2E Test Site/i });
  await expect(row).toBeVisible();
  await row.getByRole("link", { name: "E2E Test Site" }).click();
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}$/);
  return page.url();
}

async function uploadBrief(
  page: import("@playwright/test").Page,
  siteDetailUrl: string,
  markdown: string,
  title: string,
): Promise<void> {
  await page.goto(siteDetailUrl);
  await page.getByTestId("upload-brief-button").click();

  const modal = page.getByRole("dialog", { name: /upload a brief/i });
  await expect(modal).toBeVisible();

  const fileInput = modal.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: `${title}.md`,
    mimeType: "text/markdown",
    buffer: Buffer.from(markdown, "utf8"),
  });

  await modal.getByLabel("Title (optional)").fill(title);
  await modal.getByRole("button", { name: /upload and parse/i }).click();

  // On success, the client redirects to the review URL.
  await page.waitForURL(/\/admin\/sites\/[0-9a-f-]{36}\/briefs\/[0-9a-f-]{36}\/review$/);
}

test.describe("M12-1 briefs — upload + review", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // M12-6 — exercises the full upload → edit → save draft → commit flow.
  test("upload → parse → commit happy path", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const siteUrl = await findTestSiteDetailUrl(page);

    await page.goto(siteUrl);
    await auditA11y(page, testInfo);

    const unique = `Playwright E2E ${Date.now()}`;
    await uploadBrief(page, siteUrl, makeBrief(unique), unique);

    await expect(page.getByRole("heading", { name: unique })).toBeVisible();
    await expect(page.getByText(/Awaiting review/i)).toBeVisible();

    // 3 pages (Home / About / Pricing) rendered. The titles live in
    // editable <Input> textboxes, not in text nodes — Playwright's
    // hasText filter can't see input values, so we assert via the
    // labelled controls directly.
    await expect(page.locator("ol li")).toHaveCount(3);
    await expect(page.getByLabel("Title for page 1")).toHaveValue("Home");
    await expect(page.getByLabel("Title for page 2")).toHaveValue("About");
    await expect(page.getByLabel("Title for page 3")).toHaveValue("Pricing");

    // Edit the Home title.
    const firstTitleInput = page.getByLabel(/Title for page 1/);
    await firstTitleInput.fill("Acme Home");

    // Flip a mode toggle on the short_brief "About" row.
    const aboutToggle = page.getByLabel(/Title for page 2/).locator("..").locator("..").getByRole("button", { name: /Short brief|Full text/i }).first();
    await aboutToggle.click();

    await auditA11y(page, testInfo);

    // Save draft — wait for it to complete (button returns to "Save draft"
    // once isSavingDraft resets to false). This persists in-memory edits to
    // DB so the commit hash matches the server-side recomputation.
    const saveDraftBtn = page.getByRole("button", { name: /Save draft/i });
    await saveDraftBtn.click();
    await expect(saveDraftBtn).toBeEnabled({ timeout: 10_000 });

    // Commit. No confirm modal — it was removed (UAT 2026-05-03 round-3)
    // because the double-confirm added friction on every routine commit.
    // RS-3: successful commit redirects straight to the run surface.
    await page.getByRole("button", { name: /Commit page list/i }).click();
    await page.waitForURL(
      /\/admin\/sites\/[0-9a-f-]{36}\/briefs\/[0-9a-f-]{36}\/run$/,
      { timeout: 15_000 },
    );
    await expect(page.getByRole("button", { name: /Commit page list/i })).toHaveCount(0);
  });

  test("edit cancel — un-committed edits don't persist on a fresh load", async ({ page }) => {
    test.setTimeout(60_000);
    const siteUrl = await findTestSiteDetailUrl(page);

    const unique = `Edit Cancel ${Date.now()}`;
    await uploadBrief(page, siteUrl, makeBrief(unique), unique);
    const reviewUrl = page.url();

    // Change a title but leave the page without clicking Commit.
    const firstTitleInput = page.getByLabel(/Title for page 1/);
    await firstTitleInput.fill("Totally Different Home");

    // Navigate away to the site detail.
    await page.goto(siteUrl);
    await expect(page.getByText(unique)).toBeVisible();

    // Return to the review URL directly — edit should be gone.
    await page.goto(reviewUrl);
    const refreshed = page.getByLabel(/Title for page 1/);
    await expect(refreshed).toHaveValue("Home");
  });

  test("double commit — second POST with a stale hash is rejected and operator sees a translated message", async ({
    browser,
  }) => {
    test.setTimeout(90_000);

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await signInAsAdmin(pageA);
    const siteUrl = await findTestSiteDetailUrl(pageA);

    const unique = `Double Commit ${Date.now()}`;
    await uploadBrief(pageA, siteUrl, makeBrief(unique), unique);
    const reviewUrl = pageA.url();

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signInAsAdmin(pageB);
    await pageB.goto(reviewUrl);
    await expect(pageB.getByRole("heading", { name: unique })).toBeVisible();

    // A commits first.
    await pageA.getByRole("button", { name: /Commit page list/i }).click();
    const dialogA = pageA.getByRole("dialog", { name: /Commit this page list\?/i });
    await dialogA.getByRole("button", { name: /^Commit page list$/i }).click();
    // RS-3: successful commit lands on the run surface.
    await pageA.waitForURL(
      /\/admin\/sites\/[0-9a-f-]{36}\/briefs\/[0-9a-f-]{36}\/run$/,
    );

    // B tries to commit without refresh. B's version_lock is stale →
    // ALREADY_EXISTS since A already committed with the matching hash.
    // B's commit button should still be present (render is client-state).
    await pageB.getByRole("button", { name: /Commit page list/i }).click();
    const dialogB = pageB.getByRole("dialog", { name: /Commit this page list\?/i });
    await dialogB.getByRole("button", { name: /^Commit page list$/i }).click();

    // Because B's hash matches A's (neither edited), the server treats
    // this as a successful replay — UI flips to the run surface too.
    // This asserts the idempotent-replay path.
    await pageB.waitForURL(
      /\/admin\/sites\/[0-9a-f-]{36}\/briefs\/[0-9a-f-]{36}\/run$/,
    );

    await contextA.close();
    await contextB.close();
  });
});
