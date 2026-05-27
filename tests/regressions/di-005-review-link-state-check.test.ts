import { afterEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// DI-005 — Review link generated for non-pending drafts.
//
// GET /api/platform/social/drafts/[id]/review-link had no state check — tokens
// were issued for rejected, published, scheduled, and archived drafts.
// External approvers received misleading links and saw stale content.
//
// Invariants:
//   1. Returns 409 WRONG_STATE for a draft not in pending_approval.
//   2. Returns 404 for an archived (soft-deleted) draft.
//   3. Returns 200 with a url for a pending_approval draft.
// ---------------------------------------------------------------------------

const DRAFT_ID = "dddddddd-0000-4000-8000-000000000011";
const COMPANY_ID = "cccccccc-0000-4000-8000-000000000002";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn(async () => ({ kind: "allow", userId: "user-1" })),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

function makeDraftDb(state: string, archivedAt: string | null = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: archivedAt !== null ? null : { id: DRAFT_ID, company_id: COMPANY_ID, state },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
}

afterEach(() => vi.clearAllMocks());

async function callReviewLink(state: string, archived = false) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  vi.mocked(getServiceRoleClient).mockReturnValue(
    makeDraftDb(state, archived ? "2026-01-01" : null) as never,
  );
  // Provide NEXTAUTH_SECRET so SignJWT doesn't fail on 200 path.
  process.env.NEXTAUTH_SECRET = "test-secret-for-unit-tests";
  process.env.NEXT_PUBLIC_SITE_URL = "https://app.opollo.com";

  const { GET } = await import("@/app/api/platform/social/drafts/[id]/review-link/route");
  const req = new Request(`http://localhost/api/platform/social/drafts/${DRAFT_ID}/review-link`);
  return GET(req as never, { params: Promise.resolve({ id: DRAFT_ID }) as never });
}

describe("GET /api/platform/social/drafts/[id]/review-link — state check (DI-005)", () => {
  it("returns 409 WRONG_STATE for a rejected draft", async () => {
    const res = await callReviewLink("rejected");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("WRONG_STATE");
  });

  it("returns 409 WRONG_STATE for a published draft", async () => {
    const res = await callReviewLink("published");
    expect(res.status).toBe(409);
  });

  it("returns 404 for an archived draft", async () => {
    const res = await callReviewLink("pending_approval", true);
    expect(res.status).toBe(404);
  });

  it("returns 200 with a url for a pending_approval draft", async () => {
    const res = await callReviewLink("pending_approval");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.data.url).toBe("string");
    expect(body.data.url).toContain("/review/");
  });
});
