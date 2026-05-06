#!/usr/bin/env -S npx tsx
/**
 * audit-internal-error-logging.ts
 *
 * Scans `app/` and `lib/` for INTERNAL_ERROR envelope returns that
 * lack a preceding logger.error / logger.warn call. The pattern was
 * the root of the M13-5c silent-500 incident (audit triage 2026-04-27)
 * — a missing-column schema bug sat on main for 3 days because the
 * route handler swallowed the underlying error and returned a vague
 * INTERNAL_ERROR envelope with no log trail.
 *
 *   npx tsx scripts/audit-internal-error-logging.ts
 *
 * Exit codes:
 *   0  no violations found
 *   1  violations found (prints file:line for each)
 *
 * Heuristic: a violation = a line matching one of the envelope return
 * patterns where the preceding 8 lines do NOT contain `logger.error`
 * or `logger.warn`. Heuristic is conservative — it can produce false
 * positives where the upstream caller already logs. Use the output as
 * a punch-list, not a CI gate.
 *
 * BACKLOG context: "Pattern audit — silent INTERNAL_ERROR fallbacks
 * across all routes" (deferred from audit triage, 2026-04-27).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "lib"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".claude",
  "test-results",
  "playwright-report",
  "__tests__",
]);
const ENVELOPE_PATTERNS = [
  /envelope\("INTERNAL_ERROR"/,
  /code: "INTERNAL_ERROR"/,
  /errorEnvelope\("INTERNAL_ERROR"/,
  /errorResponse\("INTERNAL_ERROR"/,
  /errorResult\("INTERNAL_ERROR"/,
];
// lib/http.ts defines the internalError helper itself; it's the factory, not
// a consumer that should be logging. Exclude it from the scan.
const SKIP_FILES = new Set(["lib/http.ts"]);
// Look back 20 lines for a logger call — catch blocks that release a lease
// (like brief-runner.ts) can have logger.error more than 8 lines back.
const LOG_HORIZON = 20;

// Lines that match the envelope pattern but are TypeScript type annotations
// rather than runtime returns. Discriminators:
//   1. "INTERNAL_ERROR"; — semicolon follows the string (type syntax, not
//      object literal syntax which uses commas).
//   2. Trimmed line starts with | — union type member.
//   3. Trimmed line starts with } — closing of a generic/return-type block.
// This eliminates the 6 false positives from type-definition lines in
// lib/http.ts, lib/brief-runner.ts, lib/sites.ts, lib/tenant-budgets.ts,
// lib/invites.ts, lib/platform/brand/update.ts.
function isTypeAnnotationFalsePositive(line: string): boolean {
  const t = line.trimStart();
  if (/"INTERNAL_ERROR";/.test(line)) return true;
  if (t.startsWith("| {") || t.startsWith("| error")) return true;
  return false;
}

type Violation = { file: string; line: number; snippet: string };

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      yield* walk(p);
    } else if (
      (e.endsWith(".ts") || e.endsWith(".tsx")) &&
      !e.includes(".test.")
    ) {
      yield p;
    }
  }
}

function audit(): Violation[] {
  const out: Violation[] = [];
  for (const root of ROOTS) {
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of walk(root)) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      if (SKIP_FILES.has(rel)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (!ENVELOPE_PATTERNS.some((re) => re.test(line))) continue;
        if (isTypeAnnotationFalsePositive(line)) continue;
        const start = Math.max(0, i - LOG_HORIZON);
        const window = lines.slice(start, i + 1).join("\n");
        if (window.includes("logger.error") || window.includes("logger.warn")) {
          continue;
        }
        out.push({
          file: relative(process.cwd(), file).replace(/\\/g, "/"),
          line: i + 1,
          snippet: line.trim(),
        });
      }
    }
  }
  return out;
}

function main(): number {
  const violations = audit();
  if (violations.length === 0) {
    process.stdout.write("audit-internal-error-logging: clean\n");
    return 0;
  }
  process.stdout.write(
    `audit-internal-error-logging: ${violations.length} violation(s) across ${
      new Set(violations.map((v) => v.file)).size
    } file(s)\n\n`,
  );
  for (const v of violations) {
    process.stdout.write(`  ${v.file}:${v.line}\n    ${v.snippet}\n\n`);
  }
  return 1;
}

process.exit(main());
