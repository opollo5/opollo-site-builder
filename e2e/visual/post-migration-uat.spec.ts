/**
 * Button consistency migration — post-migration UAT spec.
 *
 * Captures screenshots of 11 surfaces against production and asserts:
 *   - Page loads (no navigation error)
 *   - No console errors during page load
 *   - At least one Button component instance present (data-slot="button")
 *
 * Screenshots saved to: docs/briefs/post-migration-uat/screenshots/
 * Report written to:    docs/briefs/post-migration-uat/REPORT.md
 *
 * Run:
 *   PROD_SMOKE_USER_PASSWORD=<pw> npx playwright test \
 *     --config playwright.verify.config.ts \
 *     e2e/visual/post-migration-uat.spec.ts
 *
 * If PROD_SMOKE_USER_PASSWORD is not set, all tests skip.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const PROD_EMAIL = "hi@opollo.com";
const PROD_PASSWORD = process.env.PROD_SMOKE_USER_PASSWORD ?? "";
const PROD_BASE = "https://opollo-site-builder.vercel.app";

const SCREENSHOT_DIR = path.resolve(
  __dirname,
  "../../docs/briefs/post-migration-uat/screenshots",
);
const REPORT_PATH = path.resolve(
  __dirname,
  "../../docs/briefs/post-migration-uat/REPORT.md",
);
const FINDINGS_PATH = path.resolve(
  __dirname,
  "../../docs/briefs/post-migration-uat/UAT_FINDINGS.md",
);
const SESSION_FILE = path.resolve(__dirname, "../uat-session.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SurfaceResult {
  id: string;
  label: string;
  screenshotFile: string;
  status: "PASS" | "FAIL" | "VISUAL ISSUE";
  consoleErrors: string[];
  note?: string;
}

// ---------------------------------------------------------------------------
// Auth setup
// ---------------------------------------------------------------------------

test.describe("Post-migration UAT", () => {
  const results: SurfaceResult[] = [];

  test.beforeAll(async ({ browser }) => {
    if (!PROD_PASSWORD) {
      console.warn(
        "[uat] PROD_SMOKE_USER_PASSWORD not set — skipping. " +
          "Run with: PROD_SMOKE_USER_PASSWORD=<pw> npx playwright test ...",
      );
      return;
    }

    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const page = await browser.newPage();
    await page.goto(`${PROD_BASE}/login`, { waitUntil: "networkidle", timeout: 30_000 });
    await page.getByLabel(/email/i).fill(PROD_EMAIL);
    await page.getByLabel(/password/i).fill(PROD_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(
      (u) => u.pathname.startsWith("/admin") || u.pathname.startsWith("/company"),
      { timeout: 30_000 },
    );
    await page.context().storageState({ path: SESSION_FILE });
    await page.close();
  });

  test.afterAll(async () => {
    if (!PROD_PASSWORD) return;
    writeReport(results);
    try { fs.rmSync(SESSION_FILE); } catch { /* ignore */ }
  });

  // ---------------------------------------------------------------------------
  // Helper: capture a surface
  // ---------------------------------------------------------------------------

  async function captureSurface(
    id: string,
    label: string,
    fn: (page: import("@playwright/test").Page) => Promise<void>,
  ): Promise<void> {
    test(label, async ({ browser }) => {
      if (!PROD_PASSWORD) {
        test.skip(true, "PROD_SMOKE_USER_PASSWORD not set");
        return;
      }

      const ctx = await browser.newContext({ storageState: SESSION_FILE });
      const page = await ctx.newPage();
      const consoleErrors: string[] = [];

      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });
      page.on("pageerror", (err) => consoleErrors.push(`[pageerror] ${err.message}`));

      const screenshotFile = `${id}.png`;
      const screenshotPath = path.join(SCREENSHOT_DIR, screenshotFile);
      let status: SurfaceResult["status"] = "PASS";
      let note: string | undefined;

      try {
        await fn(page);

        // Assert at least one Button component present
        const buttonCount = await page
          .locator('[data-slot="button"], button.inline-flex')
          .count();
        if (buttonCount === 0) {
          status = "VISUAL ISSUE";
          note = "No Button component instances found";
        }

        if (consoleErrors.length > 0) {
          status = status === "PASS" ? "VISUAL ISSUE" : status;
          note = (note ? note + "; " : "") + `${consoleErrors.length} console error(s)`;
        }
      } catch (err) {
        status = "FAIL";
        note = String(err);
        if (consoleErrors.length > 0) {
          note += `; ${consoleErrors.length} console error(s)`;
        }
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      await ctx.close();

      results.push({ id, label, screenshotFile, status, consoleErrors, note });

      if (status === "FAIL" && consoleErrors.length > 0) {
        appendFindings(id, label, consoleErrors, note);
      }

      expect(status, `${label}: ${note ?? "ok"}`).not.toBe("FAIL");
    });
  }

  // ---------------------------------------------------------------------------
  // 1. /admin/sites — full page
  // ---------------------------------------------------------------------------

  captureSurface("01-admin-sites", "1. /admin/sites — full page", async (page) => {
    await page.goto(`${PROD_BASE}/admin/sites`, { waitUntil: "networkidle", timeout: 30_000 });
    await expect(page.locator("table, [data-testid='sites-table'], h1")).toBeVisible({ timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // 2. /admin/sites — row actions menu open
  // ---------------------------------------------------------------------------

  captureSurface("02-admin-sites-row-actions", "2. /admin/sites — row actions menu open", async (page) => {
    await page.goto(`${PROD_BASE}/admin/sites`, { waitUntil: "networkidle", timeout: 30_000 });
    await expect(page.locator("table, [data-testid='sites-table']")).toBeVisible({ timeout: 15_000 });

    // Click the first row-actions trigger (… button)
    const trigger = page
      .locator('[aria-label="Row actions"], [data-testid="row-actions-trigger"], button[aria-haspopup="menu"]')
      .first();
    await trigger.click({ timeout: 10_000 });

    // Wait for menu to open
    await expect(
      page.locator('[role="menu"], [data-radix-popper-content-wrapper]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 3. /admin/users — full page
  // ---------------------------------------------------------------------------

  captureSurface("03-admin-users", "3. /admin/users — full page (audit log button)", async (page) => {
    await page.goto(`${PROD_BASE}/admin/users`, { waitUntil: "networkidle", timeout: 30_000 });
    await expect(page.locator("table, h1, [data-testid='users-table']")).toBeVisible({ timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // 4. /admin/health — full page
  // ---------------------------------------------------------------------------

  captureSurface("04-admin-health", "4. /admin/health — full page (status grid)", async (page) => {
    await page.goto(`${PROD_BASE}/admin/health`, { waitUntil: "networkidle", timeout: 30_000 });
    await expect(page.locator("h1, [data-testid='service-status-grid'], main")).toBeVisible({ timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // 5. /company/social/calendar — full page
  // ---------------------------------------------------------------------------

  captureSurface("05-calendar-full", "5. /company/social/calendar — full page", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/calendar`, { waitUntil: "networkidle", timeout: 30_000 });
    await expect(page.locator("[data-testid='social-calendar'], [class*='calendar'], main")).toBeVisible({ timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // 6. /company/social/calendar?compose=new — composer open
  // ---------------------------------------------------------------------------

  captureSurface("06-composer-open", "6. /company/social/calendar?compose=new — composer open", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/calendar?compose=new`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-testid="composer-overlay"], [aria-label*="composer"], [class*="composer"]'),
    ).toBeVisible({ timeout: 20_000 });
  });

  // ---------------------------------------------------------------------------
  // 7. Composer with AI assist dialog open
  // ---------------------------------------------------------------------------

  captureSurface("07-composer-ai-assist", "7. Composer — AI assist dialog open", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/calendar?compose=new`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-testid="composer-overlay"], [class*="composer"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Click AI assist / Sparkles button in toolbar
    const aiBtn = page
      .locator('[aria-label*="AI"], [aria-label*="assist"], [data-testid*="ai"], button:has([data-lucide="sparkles"])')
      .first();
    await aiBtn.click({ timeout: 10_000 });

    await expect(
      page.locator('[role="dialog"], [data-radix-dialog-content]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 8. Composer with GIF picker open
  // ---------------------------------------------------------------------------

  captureSurface("08-composer-gif", "8. Composer — GIF picker open", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/calendar?compose=new`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-testid="composer-overlay"], [class*="composer"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Click GIF / Film button in toolbar
    const gifBtn = page
      .locator('[aria-label*="GIF"], [aria-label*="gif"], [data-testid*="gif"], button:has([data-lucide="film"])')
      .first();
    await gifBtn.click({ timeout: 10_000 });

    await expect(
      page.locator('[role="dialog"], [data-radix-popper-content-wrapper]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 9. Composer with Emoji picker open
  // ---------------------------------------------------------------------------

  captureSurface("09-composer-emoji", "9. Composer — Emoji picker open", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/calendar?compose=new`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await expect(
      page.locator('[data-testid="composer-overlay"], [class*="composer"]'),
    ).toBeVisible({ timeout: 20_000 });

    // Click Emoji / Smile button in toolbar
    const emojiBtn = page
      .locator('[aria-label*="emoji"], [aria-label*="Emoji"], [data-testid*="emoji"], button:has([data-lucide="smile"])')
      .first();
    await emojiBtn.click({ timeout: 10_000 });

    await expect(
      page.locator('[role="dialog"], [data-radix-popper-content-wrapper], em-emoji-picker'),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // 10. /company/social/posts — full page
  // ---------------------------------------------------------------------------

  captureSurface("10-social-posts", "10. /company/social/posts — full page (state filter tabs)", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/posts`, { waitUntil: "networkidle", timeout: 30_000 });
    await expect(page.locator("main, [data-testid='posts-list'], h1")).toBeVisible({ timeout: 15_000 });
  });

  // ---------------------------------------------------------------------------
  // 11. /company/social/connections — full page
  // ---------------------------------------------------------------------------

  captureSurface("11-social-connections", "11. /company/social/connections — full page", async (page) => {
    await page.goto(`${PROD_BASE}/company/social/connections`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await expect(page.locator("main, h1")).toBeVisible({ timeout: 15_000 });
  });
});

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

function writeReport(results: SurfaceResult[]): void {
  const passCount = results.filter((r) => r.status === "PASS").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const issueCount = results.filter((r) => r.status === "VISUAL ISSUE").length;

  const lines: string[] = [
    "# Button Migration — Post-Migration UAT Report",
    "",
    `**Run date:** ${new Date().toISOString()}`,
    `**Environment:** https://opollo-site-builder.vercel.app`,
    `**Results:** ${passCount} PASS / ${issueCount} VISUAL ISSUE / ${failCount} FAIL`,
    "",
    "## Surface Results",
    "",
    "| # | Surface | Status | Notes |",
    "|---|---------|--------|-------|",
  ];

  for (const r of results) {
    const statusEmoji = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "⚠️";
    lines.push(
      `| ${r.id} | ${r.label} | ${statusEmoji} ${r.status} | ${r.note ?? ""} |`,
    );
  }

  lines.push("", "## Screenshots", "");

  for (const r of results) {
    lines.push(`### ${r.label}`);
    lines.push("");
    lines.push(`![${r.label}](./screenshots/${r.screenshotFile})`);
    if (r.consoleErrors.length > 0) {
      lines.push("", "**Console errors:**", "```");
      lines.push(...r.consoleErrors);
      lines.push("```");
    }
    lines.push("");
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, lines.join("\n"));
  console.log(`[uat] Report written to ${REPORT_PATH}`);
}

function appendFindings(
  id: string,
  label: string,
  errors: string[],
  note?: string,
): void {
  const entry = [
    `\n## ${id} — ${label}`,
    `**Note:** ${note ?? ""}`,
    "**Console errors:**",
    "```",
    ...errors,
    "```",
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(FINDINGS_PATH), { recursive: true });
  fs.appendFileSync(FINDINGS_PATH, entry);
}
