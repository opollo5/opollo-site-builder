import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — production paths must not call socialAccountCreatePortalLink.
//
// Goal A of the 2026-05-12 overnight build: the customer + admin connect
// flows use socialAccountConnect (direct OAuth), NOT the legacy hosted-
// portal flow. This test pins that contract by scanning the production
// source tree (app/, lib/, components/) for any string mention of
// socialAccountCreatePortalLink. Test mocks under lib/__tests__/ and
// dev probes under scripts/ are allowed.
//
// If anyone re-introduces the portal-link call in production, this fails.
//
// Ref: docs/incidents/2026-05-12-direct-oauth-investigation.md
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, "../..");

// Recursively collect .ts/.tsx files under a directory, excluding common
// build / dependency dirs.
function collectSourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  const skip = new Set([
    "node_modules",
    ".next",
    "dist",
    "build",
    "coverage",
    ".turbo",
  ]);
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  walk(rootDir);
  return out;
}

describe("R-NO-PORTAL-LINK: production never calls socialAccountCreatePortalLink", () => {
  it("no file under app/, lib/platform/, or components/ mentions createPortalLink (test mocks excluded)", () => {
    const offenders: string[] = [];
    const roots = [
      path.join(REPO_ROOT, "app"),
      path.join(REPO_ROOT, "lib", "platform"),
      path.join(REPO_ROOT, "components"),
    ];

    for (const root of roots) {
      const files = collectSourceFiles(root);
      for (const file of files) {
        const rel = path.relative(REPO_ROOT, file);
        // Tests under any __tests__/ folder are allowed to mock the SDK
        // method even though production no longer invokes it.
        if (rel.split(path.sep).includes("__tests__")) continue;

        const text = fs.readFileSync(file, "utf8");
        // Only consider actual call sites, not comments. The cheapest
        // approximation: strip block + line comments, then search.
        const stripped = text
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\s)\/\/.*$/gm, "");
        if (
          stripped.includes("socialAccountCreatePortalLink") ||
          /createPortalLink\s*\(/.test(stripped)
        ) {
          offenders.push(rel);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
