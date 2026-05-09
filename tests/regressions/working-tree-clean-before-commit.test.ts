import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// REGRESSION R5 — working tree must be clean before commit
//
// Incident: during the May 2026 bundle.social outage investigation,
// a fix was COMMITTED but not pushed for hours. The deployed bundle
// was stale relative to the local commit, but the local checkout
// LOOKED fine. Investigation took multiple days.
//
// The fix is to gate at commit-time: the pre-commit hook (and this
// pinned test) verifies that the .husky/pre-commit script does the
// right things — runs lint-staged AND test:unit before letting the
// commit proceed.
//
// Pinned invariant: .husky/pre-commit exists, runs lint-staged, and
// runs `npm run test:unit` (or test:precommit) before allowing the
// commit. A future refactor that strips the test step out of the
// hook fires this test.
//
// Why the unit layer: this is process gate — runtime check would
// require a clean checkout + a fresh commit attempt. The hook
// content IS the contract; pinning the contract is sufficient.
// ---------------------------------------------------------------------------

describe("R5: pre-commit hook runs unit tests before allowing commit", () => {
  const hookPath = join(process.cwd(), ".husky", "pre-commit");

  it("hook file exists", () => {
    expect(existsSync(hookPath)).toBe(true);
  });

  it("runs lint-staged on staged files", () => {
    const hook = readFileSync(hookPath, "utf8");
    expect(hook).toMatch(/lint-staged/);
  });

  it("runs npm run test:unit (catches contract drift before push)", () => {
    const hook = readFileSync(hookPath, "utf8");
    // Must call npm run test:unit (or test:precommit which delegates).
    // A bare lint-staged hook would let a failing contract test slip
    // through to CI — the May 2026 outage's "fix wasn't pushed" mode
    // is one variant of that class.
    expect(hook).toMatch(/npm\s+run\s+test:(unit|precommit)/);
  });

  it("documents the SKIP_PRECOMMIT_TESTS bypass for explicit rebases", () => {
    const hook = readFileSync(hookPath, "utf8");
    // The bypass MUST be documented inline so a developer hitting a
    // slow hook reaches for the env var, not for --no-verify.
    expect(hook).toMatch(/SKIP_PRECOMMIT_TESTS/);
  });
});
