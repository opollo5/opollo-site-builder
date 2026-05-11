import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 1 — Unit. Cross-tenant identity-leak defence — hash function.
//
// computeIdentityHash is the deterministic fingerprint that the
// cross-tenant detector queries against. Two requirements:
//   1. Deterministic: same inputs → same output across runs.
//   2. Collision-resistant for our scale: 10k random tuples produce
//      10k distinct hashes (md5 over a 14-platform * uuid-length input).
//
// Pinned here so a future change to the hash function (md5 → sha256,
// or a different input string layout) breaks loudly.
// ---------------------------------------------------------------------------

import { computeIdentityHash } from "@/lib/platform/social/connections/identity";

const KNOWN_INPUTS: Array<[string, string | null, string | null, string]> = [
  // Empty / null cases.
  ["linkedin_personal", null, null, "<null>"],
  // Single-id cases.
  ["linkedin_personal", "urn:li:person:abc", null, "1d4b61aad4c39f1aa1f168b2de7e922d"],
  ["linkedin_personal", null, "urn:li:person:abc", "36a32a605a5b81efb1c7a1d74ed45a88"],
  // Both ids.
  [
    "linkedin_personal",
    "urn:li:organization:40810993",
    "urn:li:person:cn_0IGowb1",
    "e111df8ea97905dec224b178eb6ce98b",
  ],
  // Platform discriminates: same ids on different platforms hash to
  // different values. Pinned so a future "platform-agnostic" mistake
  // can't silently collapse identities across platforms.
  ["facebook_page", "abc123", "user456", "70c2749200e52b61cdcd16f3baee604a"],
  ["linkedin_personal", "abc123", "user456", "9928976b0e5f7e0157ede48f07906cf4"],
];

describe("computeIdentityHash — pinned outputs", () => {
  for (const [platform, accountId, userId, expectedHash] of KNOWN_INPUTS) {
    it(`[snapshot] ${platform}/${accountId ?? "null"}/${userId ?? "null"} → ${expectedHash}`, () => {
      const actual = computeIdentityHash(platform, accountId, userId);
      if (expectedHash === "<null>") {
        expect(actual).toBeNull();
      } else {
        expect(actual).toBe(expectedHash);
      }
    });
  }
});

describe("computeIdentityHash — invariants", () => {
  it("returns null when both ids are null", () => {
    expect(computeIdentityHash("linkedin_personal", null, null)).toBeNull();
  });

  it("returns non-null hash when account_id is set but user_id is null", () => {
    const h = computeIdentityHash("facebook_page", "page-123", null);
    expect(h).toBeTypeOf("string");
    expect(h).toHaveLength(32);
  });

  it("returns non-null hash when user_id is set but account_id is null", () => {
    const h = computeIdentityHash("facebook_page", null, "user-456");
    expect(h).toBeTypeOf("string");
    expect(h).toHaveLength(32);
  });

  it("is deterministic: same inputs → same output across calls", () => {
    const a = computeIdentityHash("linkedin_personal", "acct-1", "user-2");
    const b = computeIdentityHash("linkedin_personal", "acct-1", "user-2");
    expect(a).toBe(b);
  });

  it("REGRESSION (i): no collisions across 10k random (platform, account, user) tuples", () => {
    // Generate 10k random tuples and assert no hash collisions. Sample
    // across all 14 supported platforms to mirror real fanout.
    const platforms = [
      "linkedin_personal",
      "linkedin_company",
      "facebook_page",
      "x",
      "gbp",
      // Plus 9 platforms we haven't yet mapped to social_platform enum
      // values but the identity lib still computes hashes for (the lib
      // accepts any string; the column it stores into accepts any
      // string).
      "INSTAGRAM",
      "TIKTOK",
      "YOUTUBE",
      "PINTEREST",
      "THREADS",
      "REDDIT",
      "BLUESKY",
      "MASTODON",
      "DISCORD",
      "SLACK",
    ];
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const platform = platforms[i % platforms.length];
      const accountId = `acct-${(i * 7919) & 0xffffffff}-${Math.random().toString(36).slice(2, 10)}`;
      const userId = `user-${(i * 104729) & 0xffffffff}-${Math.random().toString(36).slice(2, 10)}`;
      const hash = computeIdentityHash(platform, accountId, userId);
      expect(hash).toBeTypeOf("string");
      expect(seen.has(hash as string)).toBe(false);
      seen.add(hash as string);
    }
    expect(seen.size).toBe(10_000);
  });

  it("REGRESSION: same ids on different platforms hash to different values", () => {
    const a = computeIdentityHash("linkedin_personal", "shared-acct", "shared-user");
    const b = computeIdentityHash("facebook_page", "shared-acct", "shared-user");
    expect(a).not.toBe(b);
  });

  it("REGRESSION: account-only and user-only with same value hash to different outputs", () => {
    // Hash input is `platform:account:user` — placing the same value
    // in different slots must produce different hashes, otherwise the
    // detector confuses a Page id with a User id.
    const accountOnly = computeIdentityHash("facebook_page", "same-id", null);
    const userOnly = computeIdentityHash("facebook_page", null, "same-id");
    expect(accountOnly).not.toBe(userOnly);
  });
});
