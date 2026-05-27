import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// FIX-2 / D1 — Hard delete on user removal regression tests.
//
// Invariants:
//   1. DELETE /api/platform/users/[userId] returns 200 on success.
//   2. DELETE /api/platform/users/[userId] returns 404 if user has no membership.
//   3. DELETE /api/platform/users/[userId] returns 400 if userId is not a UUID.
//   4. auth.admin.deleteUser is called with the correct userId.
//   5. Gate: requires manage_users permission (admin role).
//
// Layer 1 — unit, mocked Supabase + api-gate. No real DB needed.
// ---------------------------------------------------------------------------

// Zod v4 z.string().uuid() enforces version nibble (1-8) + variant bits (8/9/a/b).
// These test constants use version 4, variant 8 to satisfy the stricter regex.
const COMPANY_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID = "cccccccc-0000-4000-8000-000000000001";

let deletedUserId: string | null = null;

function makeSupabaseMock({
  membershipCompanyId,
  deleteError,
}: {
  membershipCompanyId: string | null;
  deleteError?: { message: string } | null;
}) {
  return {
    from: (table: string) => {
      if (table === "platform_company_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                membershipCompanyId
                  ? { data: { company_id: membershipCompanyId }, error: null }
                  : { data: null, error: null },
            }),
          }),
        };
      }
      return {};
    },
    auth: {
      admin: {
        deleteUser: async (uid: string) => {
          deletedUserId = uid;
          return deleteError ? { error: deleteError } : { error: null };
        },
      },
    },
  };
}

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn(),
}));

beforeEach(() => {
  deletedUserId = null;
});

afterEach(() => vi.clearAllMocks());

async function callDelete(userId: string) {
  const { DELETE } = await import(
    "@/app/api/platform/users/[userId]/route"
  );
  const req = new Request(`http://localhost/api/platform/users/${userId}`, {
    method: "DELETE",
  });
  return DELETE(req as never, { params: { userId } });
}

describe("DELETE /api/platform/users/[userId]", () => {
  it("returns 400 for non-UUID userId", async () => {
    const res = await callDelete("not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns 404 when user has no company membership", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({ membershipCompanyId: null }) as never,
    );

    const res = await callDelete(USER_ID);
    expect(res.status).toBe(404);
  });

  it("returns 403 when caller lacks manage_users permission", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({ membershipCompanyId: COMPANY_A }) as never,
    );

    const { requireCanDoForApi } = await import("@/lib/platform/auth/api-gate");
    vi.mocked(requireCanDoForApi).mockResolvedValue({
      kind: "deny",
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    } as never);

    const res = await callDelete(USER_ID);
    expect(res.status).toBe(403);
  });

  it("calls auth.admin.deleteUser with the correct userId on success", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({ membershipCompanyId: COMPANY_A }) as never,
    );

    const { requireCanDoForApi } = await import("@/lib/platform/auth/api-gate");
    vi.mocked(requireCanDoForApi).mockResolvedValue({
      kind: "allow",
      userId: "admin-user-id",
      supabase: {} as never,
    } as never);

    const res = await callDelete(USER_ID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(deletedUserId).toBe(USER_ID);
  });

  it("returns 500 when auth.admin.deleteUser fails", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({
        membershipCompanyId: COMPANY_A,
        deleteError: { message: "Auth service unavailable" },
      }) as never,
    );

    const { requireCanDoForApi } = await import("@/lib/platform/auth/api-gate");
    vi.mocked(requireCanDoForApi).mockResolvedValue({
      kind: "allow",
      userId: "admin-user-id",
      supabase: {} as never,
    } as never);

    const res = await callDelete(USER_ID);
    expect(res.status).toBe(500);
    expect(deletedUserId).toBe(USER_ID);
  });
});
