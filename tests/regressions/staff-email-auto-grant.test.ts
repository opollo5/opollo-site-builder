import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// FIX-1 / D1 — Opollo staff (@opollo.com) auto-grant regression tests.
//
// Invariants:
//   1. acceptInvitation sets is_opollo_staff=true for @opollo.com invitees.
//   2. acceptInvitation sets is_opollo_staff=false for non-@opollo.com invitees.
//   3. acceptInvitation writes a staff_grant.auto audit row for @opollo.com.
//   4. sendInvitation bypasses ACTIVE_MEMBERSHIP_EXISTS for @opollo.com invitees.
//   5. sendInvitation still blocks ACTIVE_MEMBERSHIP_EXISTS for non-@opollo.com.
//
// Layer 1 — unit, mocked Supabase. No real DB needed.
// ---------------------------------------------------------------------------

const COMPANY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_STAFF = "cccccccc-0000-0000-0000-000000000001";
const USER_CUSTOMER = "dddddddd-0000-0000-0000-000000000001";
const INVITATION_ID = "eeeeeeee-0000-0000-0000-000000000001";

// Capture what platform_users.insert is called with.
const platformUserInserts: Array<Record<string, unknown>> = [];
// Capture what platform_staff_audit_log.insert is called with.
const auditLogInserts: Array<Record<string, unknown>> = [];

// Build a fake Supabase service role client that intercepts calls by table.
function makeSupabaseMock({
  invitationData,
  authUserId,
  membershipRows,
  platformUserExists,
}: {
  invitationData: Record<string, unknown>;
  authUserId: string;
  membershipRows: Array<{ company_id: string }>;
  platformUserExists: boolean;
}) {
  const tableHandlers: Record<string, unknown> = {
    platform_invitations: {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: invitationData, error: null }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: null }),
      }),
    },
    platform_users: {
      insert: (row: Record<string, unknown>) => {
        platformUserInserts.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: authUserId }, error: null }),
          }),
        };
      },
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            platformUserExists
              ? { data: { id: authUserId }, error: null }
              : { data: null, error: null },
        }),
      }),
    },
    platform_company_users: {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: "membership-id" }, error: null }),
        }),
      }),
      select: () => ({
        eq: (field: string, _val: unknown) => ({
          eq: () => ({
            limit: async () => ({ data: membershipRows, error: null }),
          }),
          limit: async () => ({ data: membershipRows, error: null }),
        }),
      }),
    },
    platform_staff_audit_log: {
      insert: (row: Record<string, unknown>) => {
        auditLogInserts.push(row);
        return { error: null };
      },
    },
    platform_invitations_send: {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }),
      }),
    },
  };

  return {
    from: (table: string) => tableHandlers[table] ?? {},
    auth: {
      admin: {
        createUser: async () => ({
          data: { user: { id: authUserId } },
          error: null,
        }),
      },
    },
  };
}

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Module-level mock — replaced per-test via vi.mocked().
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

const baseInvitation = {
  id: INVITATION_ID,
  company_id: COMPANY_A,
  role: "admin",
  status: "pending",
  expires_at: new Date(Date.now() + 86400_000).toISOString(),
  invited_by: "inviter-id",
  accepted_at: null,
  accepted_user_id: null,
  revoked_at: null,
  reminder_sent_at: null,
  expired_notified_at: null,
  created_at: new Date().toISOString(),
};

function makeInput(email: string) {
  return {
    rawToken: "a".repeat(32),
    email,
    fullName: "Test User",
    password: "Password123!",
  };
}

beforeEach(() => {
  platformUserInserts.length = 0;
  auditLogInserts.length = 0;
});

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Accept-path tests (acceptInvitation)
// ---------------------------------------------------------------------------

describe("acceptInvitation — is_opollo_staff detection", () => {
  it("sets is_opollo_staff=true for @opollo.com email", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({
        invitationData: { ...baseInvitation, email: "alice@opollo.com" },
        authUserId: USER_STAFF,
        membershipRows: [],
        platformUserExists: false,
      }) as never,
    );

    const { acceptInvitation, hashToken } = await import("@/lib/platform/invitations");
    // The token hash must match what the mock returns — mock always returns
    // invitationData regardless of hash, so any 32-char token works.
    const input = makeInput("alice@opollo.com");
    const result = await acceptInvitation(input);
    expect(result.ok).toBe(true);
    expect(platformUserInserts).toHaveLength(1);
    expect(platformUserInserts[0]).toMatchObject({ is_opollo_staff: true });
  });

  it("sets is_opollo_staff=false for non-@opollo.com email", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({
        invitationData: { ...baseInvitation, email: "bob@customer.com" },
        authUserId: USER_CUSTOMER,
        membershipRows: [],
        platformUserExists: false,
      }) as never,
    );

    const { acceptInvitation } = await import("@/lib/platform/invitations");
    const result = await acceptInvitation(makeInput("bob@customer.com"));
    expect(result.ok).toBe(true);
    expect(platformUserInserts).toHaveLength(1);
    expect(platformUserInserts[0]).toMatchObject({ is_opollo_staff: false });
  });

  it("writes staff_grant.auto audit row for @opollo.com acceptance", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({
        invitationData: { ...baseInvitation, email: "alice@opollo.com" },
        authUserId: USER_STAFF,
        membershipRows: [],
        platformUserExists: false,
      }) as never,
    );

    const { acceptInvitation } = await import("@/lib/platform/invitations");
    const result = await acceptInvitation(makeInput("alice@opollo.com"));
    expect(result.ok).toBe(true);
    const auditRow = auditLogInserts.find((r) => r.action === "staff_grant.auto");
    expect(auditRow).toBeDefined();
    expect(auditRow?.staff_email).toBe("alice@opollo.com");
    expect(auditRow?.company_id).toBe(COMPANY_A);
  });

  it("does NOT write staff_grant.auto audit row for non-staff acceptance", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSupabaseMock({
        invitationData: { ...baseInvitation, email: "bob@customer.com" },
        authUserId: USER_CUSTOMER,
        membershipRows: [],
        platformUserExists: false,
      }) as never,
    );

    const { acceptInvitation } = await import("@/lib/platform/invitations");
    const result = await acceptInvitation(makeInput("bob@customer.com"));
    expect(result.ok).toBe(true);
    const auditRow = auditLogInserts.find((r) => r.action === "staff_grant.auto");
    expect(auditRow).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Send-path tests (sendInvitation cross-tenant enforcement)
// ---------------------------------------------------------------------------

// sendInvitation uses its own Supabase calls — we need a different mock
// structure that handles the send flow.

function makeSendMock({
  existingUserId,
  membershipRows,
}: {
  existingUserId: string | null;
  membershipRows: Array<{ company_id: string }>;
}) {
  return {
    from: (table: string) => {
      if (table === "platform_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                existingUserId
                  ? { data: { id: existingUserId }, error: null }
                  : { data: null, error: null },
            }),
          }),
        };
      }
      if (table === "platform_company_users") {
        return {
          select: () => ({
            eq: (_field: string, _val: unknown) => ({
              limit: async () => ({ data: membershipRows, error: null }),
            }),
          }),
        };
      }
      if (table === "platform_invitations") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: "inv-id",
                  company_id: COMPANY_A,
                  email: "test@test.com",
                  role: "editor",
                  status: "pending",
                  expires_at: new Date(Date.now() + 86400_000).toISOString(),
                  invited_by: "inviter-id",
                  accepted_at: null,
                  accepted_user_id: null,
                  revoked_at: null,
                  reminder_sent_at: null,
                  expired_notified_at: null,
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  };
}

describe("sendInvitation — cross-tenant enforcement (D1)", () => {
  it("blocks non-@opollo.com invitee already in another company", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSendMock({
        existingUserId: USER_CUSTOMER,
        membershipRows: [{ company_id: "other-company-id" }],
      }) as never,
    );

    const { sendInvitation } = await import("@/lib/platform/invitations");
    const result = await sendInvitation({
      companyId: COMPANY_A,
      email: "bob@customer.com",
      role: "editor",
      invitedBy: "inviter-id",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ACTIVE_MEMBERSHIP_EXISTS");
    }
  });

  it("allows @opollo.com invitee already in another company (D1 staff exemption)", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSendMock({
        existingUserId: USER_STAFF,
        membershipRows: [{ company_id: "other-company-id" }],
      }) as never,
    );

    const { sendInvitation } = await import("@/lib/platform/invitations");
    const result = await sendInvitation({
      companyId: COMPANY_A,
      email: "alice@opollo.com",
      role: "admin",
      invitedBy: "inviter-id",
    });
    // Should not be blocked; may succeed or fail on insert (doesn't matter
    // for this assertion — the key is ACTIVE_MEMBERSHIP_EXISTS is not raised).
    if (!result.ok) {
      expect(result.error.code).not.toBe("ACTIVE_MEMBERSHIP_EXISTS");
    }
  });

  it("allows non-@opollo.com invitee with no existing company membership", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSendMock({
        existingUserId: null,
        membershipRows: [],
      }) as never,
    );

    const { sendInvitation } = await import("@/lib/platform/invitations");
    const result = await sendInvitation({
      companyId: COMPANY_A,
      email: "new@customer.com",
      role: "viewer",
      invitedBy: "inviter-id",
    });
    if (!result.ok) {
      expect(result.error.code).not.toBe("ACTIVE_MEMBERSHIP_EXISTS");
    }
  });
});
