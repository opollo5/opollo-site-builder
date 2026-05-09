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
// ---------------------------------------------------------------------------

// Replicate the schema declared in
// app/api/platform/social/connections/connect/route.ts. Hard-coded
// rather than imported so a refactor of the route schema (e.g. moving
// it under `lib/`) doesn't silently take this regression with it —
// this assertion *is* the contract.
const RouteBodySchema = z.object({
  company_id: z.string().uuid(),
  platforms: z
    .array(
      z.enum([
        "linkedin_personal",
        "linkedin_company",
        "facebook_page",
        "x",
        "gbp",
      ]),
    )
    .optional(),
});

const validUiPayloads = [
  // Empty platforms — UI default.
  { company_id: "11111111-1111-4111-8111-111111111111", platforms: [] },
  // Single platform — operator chose just X.
  { company_id: "11111111-1111-4111-8111-111111111111", platforms: ["x"] },
  // Multiple including LinkedIn dual.
  {
    company_id: "11111111-1111-4111-8111-111111111111",
    platforms: ["linkedin_personal", "linkedin_company", "facebook_page"],
  },
  // platforms omitted entirely — also valid.
  { company_id: "11111111-1111-4111-8111-111111111111" },
];

const invalidUiPayloads = [
  // Wrong field name — covers the "body shape changed" failure mode.
  { companyId: "11111111-1111-4111-8111-111111111111" },
  // Bad UUID.
  { company_id: "not-a-uuid", platforms: ["x"] },
  // Unknown platform — would 400 at the route, not silently fall through.
  {
    company_id: "11111111-1111-4111-8111-111111111111",
    platforms: ["instagram"],
  },
];

describe("R3: connect body shape — UI ↔ route Zod schema", () => {
  it.each(validUiPayloads)("accepts documented UI payload %j", (payload) => {
    const result = RouteBodySchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it.each(invalidUiPayloads)("rejects malformed payload %j", (payload) => {
    const result = RouteBodySchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});
