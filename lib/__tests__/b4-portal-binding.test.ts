import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import { issue, validate } from "@/lib/platform/magic-link";

// ---------------------------------------------------------------------------
// B4 cross-tenant binding test — DONE CRITERIA
//
// Tests the REAL route handler POST() from the actual route file.
// NOT a copy of the route's query — the real function.
//
// Red-proof contract: if the binding guard in the actual route is removed
// (.eq("company_id", companyId) in the social_connections lookup), the
// NEGATIVE test goes red because the route finds Company B's connection and
// returns a DIFFERENT 400 error ("no profile") instead of "Connection not
// found." The edit that causes red must be in:
//
//   app/api/portal/connections/[connectionId]/reconnect/route.ts
//
// NOT in this test file. If editing this file is required to make it fail,
// the test is wrong.
//
// Test server note: Next.js route handlers import server-only modules but
// run fine in Vitest's Node environment. No HTTP server needed — we call
// POST() directly and check the returned NextResponse.
// ---------------------------------------------------------------------------

// Import the ACTUAL route handler — not a copy of its query.
// If the route drifts, this import ensures the test runs the real code.
import { POST } from "@/app/api/portal/connections/[connectionId]/reconnect/route";

// Stable test IDs unique to this suite.
const COMPANY_A = "b4b400aa-0000-4000-8000-000000000001";
const COMPANY_B = "b4b400bb-0000-4000-8000-000000000002";
const CONN_A_ID = "b4b400aa-0000-4000-8000-000000000011";
const CONN_B_ID = "b4b400bb-0000-4000-8000-000000000012";

async function seedEnv() {
  const svc = getServiceRoleClient();

  await svc.from("platform_companies").delete().eq("id", COMPANY_A);
  const { error: errA } = await svc.from("platform_companies").insert({
    id: COMPANY_A, name: "B4 Binding Co A",
    slug: `b4bind-a-${COMPANY_A.slice(-4)}`,
  });
  if (errA) throw new Error(`seedCompanyA: ${errA.message}`);

  await svc.from("platform_companies").delete().eq("id", COMPANY_B);
  const { error: errB } = await svc.from("platform_companies").insert({
    id: COMPANY_B, name: "B4 Binding Co B",
    slug: `b4bind-b-${COMPANY_B.slice(-4)}`,
  });
  if (errB) throw new Error(`seedCompanyB: ${errB.message}`);

  await svc.from("social_connections").delete().eq("id", CONN_A_ID);
  const { error: errConnA } = await svc.from("social_connections").insert({
    id: CONN_A_ID, company_id: COMPANY_A,
    platform: "x",
    bundle_social_account_id: `b4-acct-a-${CONN_A_ID.slice(-4)}`,
    status: "auth_required",
  });
  if (errConnA) throw new Error(`seedConnA: ${errConnA.message}`);

  await svc.from("social_connections").delete().eq("id", CONN_B_ID);
  const { error: errConnB } = await svc.from("social_connections").insert({
    id: CONN_B_ID, company_id: COMPANY_B,
    platform: "x",
    bundle_social_account_id: `b4-acct-b-${CONN_B_ID.slice(-4)}`,
    status: "auth_required",
  });
  if (errConnB) throw new Error(`seedConnB: ${errConnB.message}`);
}

beforeEach(async () => { await seedEnv(); });

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("social_connections").delete().in("id", [CONN_A_ID, CONN_B_ID]);
  await svc.from("magic_links").delete().in("company_id", [COMPANY_A, COMPANY_B]);
  await svc.from("platform_companies").delete().in("id", [COMPANY_A, COMPANY_B]);
});

// Helper: create a test request to the real route.
function makeReq(token: string): NextRequest {
  return new NextRequest(
    "http://localhost:3000/api/portal/connections/reconnect",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    },
  );
}

// Helper: issue a portal magic link for a given company / connection.
async function issuePortalToken(companyId: string, connectionId: string) {
  return issue({
    purpose: "reconnect",
    subjectType: "social_connection",
    subjectId: connectionId,
    companyId,
  });
}

describe("B4 portal reconnect — cross-tenant binding (REAL route)", () => {
  it("NEGATIVE (security contract): Company A token + Company B connectionId returns 400 'Connection not found' — binding guard in the real route fires", async () => {
    // Issue a token bound to Company A.
    const { rawToken } = await issuePortalToken(COMPANY_A, CONN_A_ID);

    // Call the REAL POST handler with Company B's connectionId.
    // The route derives companyId server-side from the magic_links row (= COMPANY_A).
    // The binding guard .eq("company_id", companyId) then filters out CONN_B
    // because CONN_B.company_id = COMPANY_B ≠ COMPANY_A.
    const response = await POST(makeReq(rawToken), {
      params: Promise.resolve({ connectionId: CONN_B_ID }),
    });

    // THE CRITICAL ASSERTION:
    // "Connection not found." is returned ONLY when the binding guard fires.
    // If the guard is removed from the actual route, the route finds CONN_B and
    // returns a DIFFERENT 400 ("This connection has no associated profile..."),
    // making this assertion fail RED — which is exactly the signal we want.
    expect(response.status).toBe(400);
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).toBe("Connection not found.");
  });

  it("POSITIVE: Company A token + Company A's own connectionId does NOT return 'Connection not found' — binding check passes", async () => {
    // Issue a token for Company A.
    const { rawToken } = await issuePortalToken(COMPANY_A, CONN_A_ID);

    // Call the REAL POST handler with Company A's own connection.
    const response = await POST(makeReq(rawToken), {
      params: Promise.resolve({ connectionId: CONN_A_ID }),
    });

    // The binding check passes (CONN_A belongs to COMPANY_A).
    // The route then fails at profile_id (null) or bundle.social config — both are
    // 400 errors that come AFTER the binding check, not from it.
    // What we're asserting: NOT the binding error.
    const body = await response.json() as { error?: { message?: string } };
    expect(body.error?.message).not.toBe("Connection not found.");
    // The error is "no profile" — the binding passed and the route went further.
    expect(body.error?.message).toContain("no associated profile");
  });

  it("INVARIANT: magic_links.company_id is the only binding source — validate() confirms it came from the row, not the client", async () => {
    // Prove that the token encodes company_id server-side and can't be forged.
    const { rawToken, link } = await issuePortalToken(COMPANY_A, CONN_A_ID);

    // validate() reads back the magic_links row.
    const session = await validate(rawToken);
    expect(session.valid).toBe(true);
    if (!session.valid) return;

    // company_id on the row matches what was set at issue time.
    expect(session.link.company_id).toBe(COMPANY_A);
    // The row has the right subject (the specific connection).
    expect(link.company_id).toBe(COMPANY_A);
    expect(link.subject_id).toBe(CONN_A_ID);
    expect(link.purpose).toBe("reconnect");
  });
});
