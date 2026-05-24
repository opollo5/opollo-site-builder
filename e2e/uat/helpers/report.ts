import type { Page, TestInfo } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// UAT failure report helper.
//
// Writes a structured report to test-results/uat/<run>/<spec>/ containing:
//   failure.md    — human-readable summary
//   dom.html      — full page HTML snapshot
//   console.log   — all browser console messages captured during the test
//
// Screenshots and traces are captured by Playwright config (screenshot: "on",
// trace: "on"). HAR is available via the trace archive.
//
// Usage: call saveFailureReport(page, testInfo, { consoleMessages, error })
// from test.afterEach when testInfo.status !== 'passed'.
// ---------------------------------------------------------------------------

export type FailureReportOpts = {
  /** Browser console messages captured during the test */
  consoleMessages?: string[];
  /** The error that caused the test to fail */
  error?: Error | unknown;
};

export async function saveFailureReport(
  page: Page,
  testInfo: TestInfo,
  opts: FailureReportOpts = {},
): Promise<void> {
  if (testInfo.status === "passed") return;

  const runId = process.env.GITHUB_RUN_ID ?? `local-${Date.now()}`;
  const specSlug = testInfo.titlePath.join("/").replace(/[^a-z0-9]+/gi, "-");
  const dir = path.join("test-results", "uat", runId, specSlug);
  fs.mkdirSync(dir, { recursive: true });

  // DOM snapshot
  try {
    const html = await page.content();
    fs.writeFileSync(path.join(dir, "dom.html"), html, "utf8");
  } catch {
    // page may be closed on timeout — skip
  }

  // Console log
  if (opts.consoleMessages && opts.consoleMessages.length > 0) {
    fs.writeFileSync(
      path.join(dir, "console.log"),
      opts.consoleMessages.join("\n"),
      "utf8",
    );
  }

  // failure.md
  const errorMsg =
    opts.error instanceof Error
      ? opts.error.message
      : opts.error
        ? String(opts.error)
        : testInfo.error?.message ?? "(no error message)";

  const md = [
    `# UAT Failure Report`,
    ``,
    `**Test:** ${testInfo.titlePath.join(" › ")}`,
    `**Status:** ${testInfo.status}`,
    `**Run ID:** ${runId}`,
    `**URL at failure:** ${page.url()}`,
    `**Date:** ${new Date().toISOString()}`,
    ``,
    `## Error`,
    ``,
    "```",
    errorMsg,
    "```",
    ``,
    `## Artifacts`,
    ``,
    `- dom.html — full page HTML at point of failure`,
    `- console.log — browser console output`,
    `- Screenshots and trace captured by Playwright (see test-results/uat/)`,
    ``,
  ].join("\n");

  fs.writeFileSync(path.join(dir, "failure.md"), md, "utf8");
}

/**
 * Create a console message collector for use in test body.
 * Add `const messages = collectConsole(page);` in beforeEach,
 * then pass `messages` to saveFailureReport.
 */
export function collectConsole(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => {
    messages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    messages.push(`[pageerror] ${err.message}`);
  });
  return messages;
}
