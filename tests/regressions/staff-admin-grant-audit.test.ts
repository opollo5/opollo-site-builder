import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// FIX-3 / DI-007 — Implicit staff admin grant audit logging regression tests.
//
// When an Opollo operator logs in via the platform but has no platform_users
// row yet, getCurrentPlatformSession auto-provisions them via opollo_users
// and sets is_opollo_staff=true. This implicit grant MUST be logged in
// platform_staff_audit_log (D4).
//
// Invariants:
//   1. Auto-provision path calls logStaffAction with action="staff_grant.auto".
//   2. Auto-provision path calls logStaffAction with the correct staff userId.
//   3. Non-staff path (existing platform_users row) does NOT call logStaffAction.
//
// Layer 1 — unit, mocked Supabase + staff-audit helper.
// ---------------------------------------------------------------------------

const STAFF_USER_ID = "cccccccc-0000-4000-8000-000000000001";
const STAFF_EMAIL = "alice@opollo.com";

const logStaffActionCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/platform/staff-audit", () => ({
  logStaffAction: vi.fn(async (params: Record<string, unknown>) => {
    logStaffActionCalls.push(params);
  }),
}));

vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// next/headers.cookies() is called in resolveStaffCookieCompany; mock it to
// avoid "outside request context" throws in the test environment.
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ get: () => undefined })),
}));

function makeAuthClient(userId: string, email: string) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: userId, email } },
        error: null,
      }),
    },
  };
}

function makeServiceClient({
  platformUserData,
  opolloUserData,
  upsertError,
}: {
  platformUserData: Record<string, unknown> | null;
  opolloUserData: Record<string, unknown> | null;
  upsertError?: { message: string } | null;
}) {
  return {
    from: (table: string) => {
      if (table === "platform_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: platformUserData, error: null }),
            }),
          }),
          upsert: () =>
            upsertError
              ? Promise.resolve({ error: upsertError })
              : Promise.resolve({ error: null }),
        };
      }
      if (table === "opollo_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opolloUserData, error: null }),
            }),
          }),
        };
      }
      if (table === "platform_company_users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      return {};
    },
  };
}

beforeEach(() => {
  logStaffActionCalls.length = 0;
});

afterEach(() => vi.clearAllMocks());

describe("getCurrentPlatformSession — implicit staff grant audit (DI-007)", () => {
  it("calls logStaffAction with staff_grant.auto on opollo_users auto-provision", async () => {
    const { createRouteAuthClient } = await import("@/lib/auth");
    vi.mocked(createRouteAuthClient).mockReturnValue(
      makeAuthClient(STAFF_USER_ID, STAFF_EMAIL) as never,
    );

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeServiceClient({
        platformUserData: null,       // no platform_users row yet
        opolloUserData: { id: STAFF_USER_ID }, // exists in opollo_users
      }) as never,
    );

    const { getCurrentPlatformSession } = await import(
      "@/lib/platform/auth/current-user"
    );
    const session = await getCurrentPlatformSession();

    expect(session).not.toBeNull();
    expect(session?.isOpolloStaff).toBe(true);
    expect(logStaffActionCalls).toHaveLength(1);
    expect(logStaffActionCalls[0]).toMatchObject({
      action: "staff_grant.auto",
      staffUserId: STAFF_USER_ID,
    });
  });

  it("includes the staff email in the logStaffAction call", async () => {
    const { createRouteAuthClient } = await import("@/lib/auth");
    vi.mocked(createRouteAuthClient).mockReturnValue(
      makeAuthClient(STAFF_USER_ID, STAFF_EMAIL) as never,
    );

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeServiceClient({
        platformUserData: null,
        opolloUserData: { id: STAFF_USER_ID },
      }) as never,
    );

    const { getCurrentPlatformSession } = await import(
      "@/lib/platform/auth/current-user"
    );
    await getCurrentPlatformSession();

    expect(logStaffActionCalls[0]).toMatchObject({
      staffEmail: STAFF_EMAIL,
    });
  });

  it("does NOT call logStaffAction for existing platform_users row", async () => {
    const { createRouteAuthClient } = await import("@/lib/auth");
    vi.mocked(createRouteAuthClient).mockReturnValue(
      makeAuthClient(STAFF_USER_ID, STAFF_EMAIL) as never,
    );

    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeServiceClient({
        platformUserData: { is_opollo_staff: true }, // row already exists
        opolloUserData: { id: STAFF_USER_ID },
      }) as never,
    );

    const { getCurrentPlatformSession } = await import(
      "@/lib/platform/auth/current-user"
    );
    await getCurrentPlatformSession();

    expect(logStaffActionCalls).toHaveLength(0);
  });
});
