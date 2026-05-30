import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R7 — env var names are stable across every consumer
//
// Original incident (2026-01): bundle.social uses TEAMID (no underscore)
// while every other Vercel-provisioned env var in this project uses
// snake_case like `_TEAM_ID`. The pre-fix code looked up
// `BUNDLE_SOCIAL_TEAM_ID`, which was `undefined`, so the create-portal-link
// call shipped without a team id — resulting in a tokenless URL.
//
// Second incident (PR #904, 2026-05-19, alert fired 2026-05-21 02:43 UTC):
// a new V2 bundle.social client at lib/social/publishing/bundle-social-client.ts
// looked up `BUNDLE_SOCIAL_API_KEY` (a name that does not exist in Vercel)
// instead of the canonical `BUNDLE_SOCIAL_API`. The original R7 test only
// inspected lib/bundlesocial.ts, so it did not catch the new file.
//
// Broadened invariant: ANY `process.env.BUNDLE_SOCIAL_*` reference anywhere
// under `lib/` or `app/` must use a name from the canonical allowlist below.
// The canonical allowlist is what is actually set in Vercel production
// (verified 2026-05-28 via `vercel env ls production`):
//
//   BUNDLE_SOCIAL_API       — API key from the bundle.social dashboard
//   BUNDLE_SOCIAL_TEAMID    — team id (no underscore — matches Vercel env)
//
// Note: `BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET` uses a different prefix
// (`BUNDLESOCIAL_*`, no underscore between BUNDLE and SOCIAL) and is not
// matched by the `BUNDLE_SOCIAL_*` regex below.
//
// Why pinned at the unit layer: a daily drift detector covers the
// "are they SET in production" question. This test covers the
// "is the code looking for the right names" question — orthogonal.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const CANONICAL_BUNDLE_SOCIAL_NAMES = new Set([
  "BUNDLE_SOCIAL_API",
  "BUNDLE_SOCIAL_TEAMID",
]);

const SCAN_ROOTS = ["lib", "app"];
const SCAN_EXTENSIONS = [".ts", ".tsx"];

function walkTsFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [join(process.cwd(), root)];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // Skip node_modules and build dirs defensively.
        if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        stack.push(full);
      } else if (SCAN_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  name: string;
}

function scanAll(): Hit[] {
  const hits: Hit[] = [];
  // Match `process.env.BUNDLE_SOCIAL_<NAME>` — i.e. names that start with
  // BUNDLE_SOCIAL_ (with the underscore between BUNDLE and SOCIAL).
  const re = /process\.env\.(BUNDLE_SOCIAL_[A-Z0-9_]+)/g;
  for (const root of SCAN_ROOTS) {
    for (const file of walkTsFiles(root)) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
          hits.push({ file: file.split(process.cwd() + sep).join(""), line: i + 1, name: m[1] });
        }
      }
    }
  }
  return hits;
}

describe("R7: bundle.social env var names are pinned across lib/ and app/", () => {
  const hits = scanAll();

  it("scans something — guards against the scan silently finding zero files", () => {
    // Sanity: lib/bundlesocial.ts is known to contain at least
    // BUNDLE_SOCIAL_API and BUNDLE_SOCIAL_TEAMID, so the scan must find
    // at least 2 hits.
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("every process.env.BUNDLE_SOCIAL_* reference uses a canonical name", () => {
    const violations = hits.filter((h) => !CANONICAL_BUNDLE_SOCIAL_NAMES.has(h.name));
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  - ${v.file}:${v.line} reads process.env.${v.name}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} non-canonical BUNDLE_SOCIAL_* env var reference(s).\n` +
          `Canonical names (set in Vercel): ${[...CANONICAL_BUNDLE_SOCIAL_NAMES].join(", ")}\n` +
          `Violations:\n${detail}`,
      );
    }
  });

  it("lib/bundlesocial.ts still reads BUNDLE_SOCIAL_API (canonical anchor)", () => {
    const src = readFileSync(join(process.cwd(), "lib", "bundlesocial.ts"), "utf8");
    expect(src).toMatch(/process\.env\.BUNDLE_SOCIAL_API\b/);
  });

  it("lib/bundlesocial.ts still reads BUNDLE_SOCIAL_TEAMID (no underscore — matches Vercel env)", () => {
    const src = readFileSync(join(process.cwd(), "lib", "bundlesocial.ts"), "utf8");
    expect(src).toMatch(/process\.env\.BUNDLE_SOCIAL_TEAMID\b/);
    expect(src).not.toMatch(/process\.env\.BUNDLE_SOCIAL_TEAM_ID/);
  });

  it("BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET prefix (no underscore) is preserved in lib/bundlesocial.ts", () => {
    const src = readFileSync(join(process.cwd(), "lib", "bundlesocial.ts"), "utf8");
    expect(src).toMatch(/BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET/);
    expect(src).not.toMatch(/BUNDLE_SOCIAL_WEBHOOK_SIGNING_SECRET/);
  });
});
