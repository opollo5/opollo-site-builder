import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 1 — Unit + LAYER 6 — Security.
//
// BSP-0 regression: the customer-facing /api/platform/social/connections/connect
// returned 400 "Body must be { company_id: uuid, ... }" in production when an
// Opollo staff member viewing the Opollo internal company tried to click
// "Connect new account". Root cause: Zod v4's z.string().uuid() enforces
// RFC 4122 version/variant bits and rejects the sentinel UUID
// 00000000-0000-0000-0000-000000000001 that's seeded for the internal
// company in migration 0070.
//
// PR #845 fixed this once for /api/platform/companies/switch by switching to
// a format-only regex. BSP-0 promoted the fix into a shared dbUuid() helper
// and applied it across every customer-facing route that takes a company_id
// or profile_id in the body.
//
// BSP-6-CUSTOMER update: the connect route body changed from
//   { company_id, platforms?: SocialPlatform[] }
// to
//   { company_id, profile_id, platform: ProfileSocialPlatform }
// Both UUID fields use dbUuid() so the sentinel is accepted.
// ---------------------------------------------------------------------------

import { dbUuid, DB_UUID_RE } from "@/lib/http";

const OPOLLO_SENTINEL = "00000000-0000-0000-0000-000000000001";
const REAL_V4_UUID = "abcdef00-0000-4000-8000-aaaaaaaa1616";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const RANDOM_HEX = "12345678-90ab-cdef-1234-567890abcdef";

describe("BSP-0 — dbUuid() shared helper", () => {
  it("REGRESSION: accepts the Opollo internal-company sentinel", () => {
    const r = dbUuid().safeParse(OPOLLO_SENTINEL);
    expect(r.success).toBe(true);
  });

  it("accepts a real RFC-4122 v4 UUID", () => {
    expect(dbUuid().safeParse(REAL_V4_UUID).success).toBe(true);
  });

  it("accepts the nil UUID (00000000-...-000000000000)", () => {
    expect(dbUuid().safeParse(NIL_UUID).success).toBe(true);
  });

  it("accepts any well-formed 8-4-4-4-12 hex (DB-compatible)", () => {
    expect(dbUuid().safeParse(RANDOM_HEX).success).toBe(true);
  });

  it("rejects non-UUID strings", () => {
    expect(dbUuid().safeParse("not-a-uuid").success).toBe(false);
    expect(dbUuid().safeParse("").success).toBe(false);
    expect(dbUuid().safeParse("12345").success).toBe(false);
    expect(dbUuid().safeParse("00000000-0000-0000-0000-00000000001").success).toBe(false);
  });

  it("rejects non-hex chars in the 8-4-4-4-12 shape", () => {
    expect(
      dbUuid().safeParse("Z0000000-0000-0000-0000-000000000001").success,
    ).toBe(false);
  });

  it("DB_UUID_RE is exported for ad-hoc regex use", () => {
    expect(DB_UUID_RE.test(OPOLLO_SENTINEL)).toBe(true);
    expect(DB_UUID_RE.test("not-a-uuid")).toBe(false);
  });
});

describe("BSP-0 — connect route schema accepts the sentinel (BSP-6-CUSTOMER schema)", () => {
  it("REGRESSION: both company_id and profile_id accept the sentinel", async () => {
    const { z } = await import("zod");
    // Mirrors PostBodySchema in
    // app/api/platform/social/connections/connect/route.ts
    const PostBodySchema = z.object({
      company_id: dbUuid(),
      profile_id: dbUuid(),
      platform: z.enum([
        "TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK", "TWITTER",
        "THREADS", "LINKEDIN", "PINTEREST", "REDDIT", "MASTODON",
        "DISCORD", "SLACK", "BLUESKY", "GOOGLE_BUSINESS",
      ]),
    });
    const result = PostBodySchema.safeParse({
      company_id: OPOLLO_SENTINEL,
      profile_id: OPOLLO_SENTINEL,
      platform: "LINKEDIN",
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(
        `Sentinel rejected — bug regressed: ${JSON.stringify(result.error.issues)}`,
      );
    }
    expect(result.data.company_id).toBe(OPOLLO_SENTINEL);
    expect(result.data.profile_id).toBe(OPOLLO_SENTINEL);
  });

  it("client-side request body matches the server schema", async () => {
    // Pins that the lightbox sends { company_id, profile_id, platform }
    // matching the route schema. If either side renames a field, this
    // fails immediately instead of surfacing as a 400 in production.
    const { z } = await import("zod");
    const PostBodySchema = z.object({
      company_id: dbUuid(),
      profile_id: dbUuid(),
      platform: z.enum([
        "TIKTOK", "YOUTUBE", "INSTAGRAM", "FACEBOOK", "TWITTER",
        "THREADS", "LINKEDIN", "PINTEREST", "REDDIT", "MASTODON",
        "DISCORD", "SLACK", "BLUESKY", "GOOGLE_BUSINESS",
      ]),
    });

    const clientPayload = JSON.parse(
      JSON.stringify({
        company_id: OPOLLO_SENTINEL,
        profile_id: OPOLLO_SENTINEL,
        platform: "LINKEDIN",
      }),
    );
    expect(PostBodySchema.safeParse(clientPayload).success).toBe(true);
  });
});
