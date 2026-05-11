import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 1 — Unit. Cross-tenant identity-leak defence — hash function.
//
// computeIdentityHash is the deterministic fingerprint that the
// cross-tenant detector queries against. Two requirements:
//   1. Deterministic: same inputs → same output across runs.
//   2. Collision-resistant for our scale: 10k random tuples produce
//      10k distinct hashes (sha256 over a 14-platform * uuid-length input).
//
// Pinned here so a future change to the hash function (or a different
// input string layout) breaks loudly.
// ---------------------------------------------------------------------------

import { computeIdentityHash } from "@/lib/platform/social/connections/identity";

const KNOWN_INPUTS: Array<[string, string | null, string | null, string]> = [
  // Empty / null cases.
  ["linkedin_personal", null, null, "<null>"],
  // Single-id cases.
  ["linkedin_personal", "urn:li:person:abc", null, "324cd6939795560f9d44e4cad9b479168f4b820adeeb685bd5424d92e2897999"],
  ["linkedin_personal", null, "urn:li:person:abc", "a5b29eccf9bd5f9082bd0ce2cc423463f662fa20e0fe6a9e0dafefc4987eb89d"],
  // Both ids.
  [
    "linkedin_personal",
    "urn:li:organization:40810993",
    "urn:li:person:cn_0IGowb1",
    "a0deb66389439709774ea46e10f66b2999ecd497285e09bd55c6bc6205c755e1",
  ],
  // Platform discriminates: same ids on different platforms hash to
  // different values. Pinned so a future "platform-agnostic" mistake
  // can't silently collapse identities across platforms.
  ["facebook_page", "abc123", "user456", "618f90e33c844a83677379f7c557ba5b950eb0c6c8aacc0c5d28e54be4a7a410"],
  ["linkedin_personal", "abc123", "user456", "09751a52c7ed3ce464107c5e2e04d4faf486c9d4c5bd1da8ac569e7e57d6d868"],
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
    expect(h).toHaveLength(64);
  });

  it("returns non-null hash when user_id is set but account_id is null", () => {
    const h = computeIdentityHash("facebook_page", null, "user-456");
    expect(h).toBeTypeOf("string");
    expect(h).toHaveLength(64);
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
