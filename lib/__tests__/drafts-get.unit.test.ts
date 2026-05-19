import { describe, it, expect, vi, beforeEach } from "vitest";

// Audit gap A-5 regression guard.
// Verifies that getDraft returns a row with created_by (not created_by_user_id).
// The DB column is named created_by; both the Draft type and DB schema agree.
// If this assertion breaks it means either the DB column was renamed or the
// select was changed to alias it — both require a deliberate decision.

vi.mock("server-only", () => ({}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import { getDraft } from "@/lib/platform/social/drafts";

const DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const COMPANY_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const USER_ID = "cccccccc-0000-0000-0000-000000000003";

const SEEDED_DRAFT = {
  id: DRAFT_ID,
  company_id: COMPANY_ID,
  created_by: USER_ID,
  updated_by: USER_ID,
  draft_version: 1,
  draft_data: {
    master_text: "Test post",
    media_refs: [],
    target_connection_ids: [],
    approval_required: false,
  },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  archived_at: null,
};

function makeChain(result: { data: unknown; error: null | { message: string } }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

describe("getDraft — response shape (audit gap A-5 regression)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns created_by (not created_by_user_id) when draft exists", async () => {
    mockFrom.mockReturnValue(makeChain({ data: SEEDED_DRAFT, error: null }));

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.created_by).toBe(USER_ID);
    // Verify no accidental aliasing introduced a created_by_user_id field
    expect((result.data as Record<string, unknown>)["created_by_user_id"]).toBeUndefined();
  });

  it("returns NOT_FOUND when row is null", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }));

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns INTERNAL_ERROR on DB error", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: { message: "connection refused" } }));

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INTERNAL_ERROR");
  });
});
