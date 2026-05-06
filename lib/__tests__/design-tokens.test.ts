/**
 * lib/__tests__/design-tokens.test.ts
 *
 * Validates that lib/design-system/tokens.ts is the single source of truth
 * for design tokens, and that component files do not introduce raw hex colours
 * or arbitrary px font sizes that bypass the token system.
 *
 * These tests are intentionally narrow — they don't catch every possible
 * violation, but they catch the most common regressions:
 *   - Hardcoded hex colours in className / style attributes in components
 *   - Arbitrary Tailwind text-[Xpx] values in component files
 *   - Sub-16px font-size values in tokens.ts itself (except the eyebrow exception)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";

import { typography, buildCssVariableBlock } from "@/lib/design-system/tokens";

const REPO_ROOT = join(__dirname, "..", "..");

// ─── helpers ────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set([
  "node_modules", ".next", ".git", "__tests__", "_fixtures", "__fixtures__",
  "__evals__", "_evals", "coverage", "test-results", "playwright-report",
]);

function* walkFiles(dir: string, exts: string[]): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { yield* walkFiles(p, exts); }
    else if (exts.some((x) => e.endsWith(x))) yield p;
  }
}

function readSafe(p: string): string {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function rel(p: string): string {
  return relative(REPO_ROOT, p).replace(/\\/g, "/");
}

// ─── Test 1: tokens.ts font sizes are all ≥ 16px (except documented eyebrow exception) ──

describe("design-system/tokens.ts", () => {
  it("has no font size below 16px (1rem) except the documented eyebrow exception", () => {
    const violations: string[] = [];
    for (const [key, value] of Object.entries(typography.fontSize)) {
      // eyebrow is a documented design exception (0.75rem/12px — sits above headings;
      // 16px would invert the visual hierarchy)
      if (key === "eyebrow") continue;
      const px = parseToPx(value);
      if (px !== null && px < 16) {
        violations.push(`typography.fontSize.${key} = ${value} (${px}px) — below 16px minimum`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("eyebrow is 0.75rem (12px — documented design exception)", () => {
    expect(typography.fontSize.eyebrow).toBe("0.75rem");
  });
});

function parseToPx(value: string): number | null {
  const remMatch = value.match(/^([\d.]+)rem$/);
  if (remMatch) return parseFloat(remMatch[1]) * 16;
  const pxMatch = value.match(/^([\d.]+)px$/);
  if (pxMatch) return parseFloat(pxMatch[1]);
  return null;
}

// ─── Test 2: buildCssVariableBlock ───────────────────────────────────────────

describe("buildCssVariableBlock", () => {
  it("returns empty string for empty overrides", () => {
    expect(buildCssVariableBlock({})).toBe("");
  });

  it("emits a :root block with supplied values", () => {
    const result = buildCssVariableBlock({ colorPk: "#ff0000", radiusLg: "8px" });
    expect(result).toContain("--pk: #ff0000");
    expect(result).toContain("--radius: 8px");
    expect(result).toMatch(/^:root \{/);
  });

  it("supports legacy radius key for backwards compatibility", () => {
    const result = buildCssVariableBlock({ radius: "12px" });
    expect(result).toContain("--radius: 12px");
  });

  it("omits undefined keys", () => {
    expect(buildCssVariableBlock({ colorPk: "#ff0000" })).not.toContain("--gr");
  });
});

// ─── Test 3: no raw hex in component className/style props ───────────────────

describe("component files", () => {
  const EXEMPT_PATHS = [
    "lib/email/templates/",
    "lib/email/",
    // Email-sending routes contain inline HTML with inline styles for mail
    // client compatibility — same exemption rationale as lib/email/.
    "app/api/admin/email-test/",
    "app/globals.css",
    "styles/tokens.css",
    "seed/",
    "public/",
    "lib/__tests__/",
    "e2e/",
  ];

  function isExempt(filePath: string): boolean {
    const r = rel(filePath);
    return EXEMPT_PATHS.some((p) => r.startsWith(p) || r.includes(p));
  }

  it("contain no hardcoded hex colours in className/style props", () => {
    const hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;
    const violations: string[] = [];

    for (const root of ["app", "components"]) {
      const dir = join(REPO_ROOT, root);
      for (const file of walkFiles(dir, [".tsx", ".ts"])) {
        if (isExempt(file)) continue;
        const lines = readSafe(file).split(/\r?\n/);
        lines.forEach((ln, i) => {
          const stripped = ln.replace(/\/\/.*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
          if (hexRe.test(stripped) && /className|style\s*[=:]/.test(stripped)) {
            violations.push(`${rel(file)}:${i + 1} — ${ln.trim().slice(0, 80)}`);
          }
        });
      }
    }

    if (violations.length > 0) {
      console.log("Hardcoded hex violations:\n" + violations.join("\n"));
    }
    expect(violations).toEqual([]);
  });

  it("contain no arbitrary Tailwind text-[Xpx] values", () => {
    const arbitraryRe = /\btext-\[\d+px\]/;
    const violations: string[] = [];

    for (const root of ["app", "components"]) {
      const dir = join(REPO_ROOT, root);
      for (const file of walkFiles(dir, [".tsx", ".ts"])) {
        if (isExempt(file)) continue;
        const lines = readSafe(file).split(/\r?\n/);
        lines.forEach((ln, i) => {
          const stripped = ln.replace(/\/\/.*/g, "");
          if (arbitraryRe.test(stripped)) {
            violations.push(`${rel(file)}:${i + 1} — ${ln.trim().slice(0, 80)}`);
          }
        });
      }
    }

    if (violations.length > 0) {
      console.log("Arbitrary text-[Xpx] violations:\n" + violations.join("\n"));
    }
    expect(violations).toEqual([]);
  });
});
