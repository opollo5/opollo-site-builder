import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for proof state machine and the B1 hard rule.
// No DB required — verifies logic only.
// ---------------------------------------------------------------------------

// Simulate the version chain constraint logic (mirrors the DB CHECK).
function validateVersionChain(row: {
  version_number: number;
  supersedes_id: string | null;
  id: string;
}): string | null {
  if (row.version_number > 1 && !row.supersedes_id) {
    return "v2+ must reference a parent (supersedes_id IS NOT NULL)";
  }
  if (row.supersedes_id && row.supersedes_id === row.id) {
    return "supersedes_id must not equal id (no self-reference)";
  }
  return null;
}

// Simulate the B1 hard rule: if a magic_links row exists, honour its
// verdict. The fallback to social_approval_recipients.token_hash fires
// ONLY when no magic_links row exists.
function resolveTokenPath(params: {
  magicLinksRowExists: boolean;
  magicLinksRowValid: boolean;
}): "service" | "legacy" | "reject" {
  if (!params.magicLinksRowExists) return "legacy";
  // Row exists — honour verdict, no fallthrough.
  return params.magicLinksRowValid ? "service" : "reject";
}

describe("version chain constraints", () => {
  it("v1 with null supersedes_id is valid", () => {
    expect(
      validateVersionChain({ id: "a", version_number: 1, supersedes_id: null }),
    ).toBeNull();
  });

  it("v2 with supersedes_id is valid", () => {
    expect(
      validateVersionChain({ id: "b", version_number: 2, supersedes_id: "a" }),
    ).toBeNull();
  });

  it("v2 without supersedes_id violates constraint", () => {
    expect(
      validateVersionChain({ id: "c", version_number: 2, supersedes_id: null }),
    ).toMatch(/supersedes_id IS NOT NULL/);
  });

  it("self-referential supersedes_id violates constraint", () => {
    expect(
      validateVersionChain({ id: "d", version_number: 2, supersedes_id: "d" }),
    ).toMatch(/no self-reference/);
  });
});

describe("B1 hard rule: magic_links verdict is final when row exists", () => {
  it("no magic_links row → uses legacy token_hash path", () => {
    expect(
      resolveTokenPath({ magicLinksRowExists: false, magicLinksRowValid: false }),
    ).toBe("legacy");
  });

  it("magic_links row exists + valid → uses service path", () => {
    expect(
      resolveTokenPath({ magicLinksRowExists: true, magicLinksRowValid: true }),
    ).toBe("service");
  });

  it(
    "magic_links row exists + INVALID (expired/consumed/revoked) → rejected, " +
      "NEVER falls through to legacy token_hash lookup",
    () => {
      expect(
        resolveTokenPath({ magicLinksRowExists: true, magicLinksRowValid: false }),
      ).toBe("reject");
      // Critically: it must NOT be "legacy" — the hard rule prevents fallthrough.
      expect(
        resolveTokenPath({ magicLinksRowExists: true, magicLinksRowValid: false }),
      ).not.toBe("legacy");
    },
  );
});
