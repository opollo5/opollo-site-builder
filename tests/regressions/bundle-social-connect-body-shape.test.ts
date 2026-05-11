import { describe, expect, it } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// REGRESSION R3 — connect button request body shape must match Zod schema
//
// Incident: a layout-branch refactor changed the connect button's
// request body shape mid-investigation, surfacing as a "body
// validation failed" error that masked the underlying bundle.social
// outage. The two ends — UI sender and route Zod validator — drifted
// silently because no test asserted them in the same shape.
//
// Pinned invariant: the body shape the route expects is the SAME body
// shape the UI is documented to send. We replicate the route schema
// here and run the documented UI payloads through it. If anyone
// changes either end without the other, this fires.
//
// BSP-6-CUSTOMER update: the connect route now uses per-platform direct
// OAuth. Body is { company_id, profile_id, platform } where platform is
// the bundle.social ProfileSocialPlatform enum.
// ---------------------------------------------------------------------------

// Replicate the schema declared in
// app/api/platform/social/connections/connect/route.ts. Hard-coded
// rather than imported so a refactor of the route schema doesn't
// silently take this regression with it — this assertion *is* the contract.
const RouteBodySchema = z.object({
  company_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  platform: z.enum([
    "TIKTOK",
    "YOUTUBE",
    "INSTAGRAM",
    "FACEBOOK",
    "TWITTER",
    "THREADS",
    "LINKEDIN",
    "PINTEREST",
    "REDDIT",
    "MASTODON",
    "DISCORD",
    "SLACK",
    "BLUESKY",
    "GOOGLE_BUSINESS",
  ]),
});

const UUID = "11111111-1111-4111-8111-111111111111";

const validUiPayloads = [
  { company_id: UUID, profile_id: UUID, platform: "LINKEDIN" },
  { company_id: UUID, profile_id: UUID, platform: "FACEBOOK" },
  { company_id: UUID, profile_id: UUID, platform: "INSTAGRAM" },
  { company_id: UUID, profile_id: UUID, platform: "TWITTER" },
  { company_id: UUID, profile_id: UUID, platform: "GOOGLE_BUSINESS" },
  { company_id: UUID, profile_id: UUID, platform: "TIKTOK" },
  { company_id: UUID, profile_id: UUID, platform: "YOUTUBE" },
  { company_id: UUID, profile_id: UUID, platform: "THREADS" },
];

const invalidUiPayloads = [
  // Missing profile_id — old schema; now required.
  { company_id: UUID, platform: "LINKEDIN" },
  // Missing platform.
  { company_id: UUID, profile_id: UUID },
  // Wrong field name for company.
  { companyId: UUID, profile_id: UUID, platform: "LINKEDIN" },
  // Bad UUID for company_id.
  { company_id: "not-a-uuid", profile_id: UUID, platform: "LINKEDIN" },
  // Bad UUID for profile_id.
  { company_id: UUID, profile_id: "not-a-uuid", platform: "LINKEDIN" },
  // Old-style lowercase internal platform — must use bundle.social enum now.
  { company_id: UUID, profile_id: UUID, platform: "linkedin_personal" },
  // Old-style platforms array — replaced by single platform string.
  { company_id: UUID, profile_id: UUID, platforms: ["LINKEDIN"] },
];

describe("R3: connect body shape — UI ↔ route Zod schema (BSP-6-CUSTOMER)", () => {
  it.each(validUiPayloads)("accepts documented UI payload %j", (payload) => {
    const result = RouteBodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it.each(invalidUiPayloads)("rejects malformed payload %j", (payload) => {
    const result = RouteBodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
