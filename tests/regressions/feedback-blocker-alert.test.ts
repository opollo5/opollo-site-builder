// tests/regressions/feedback-blocker-alert.test.ts
//
// Guarantee: a ticket_created (blocker severity) dispatch MUST reach >=1
// recipient. resolveOpolloAdmins is the single resolution path for this
// event; it must throw (not return []) when the DB has no staff rows, so
// the failure surfaces through dispatch's error envelope rather than
// being silently dropped.
//
// Layer 1 — unit tests; all I/O mocked. No DB or network required.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn(async () => ({ ok: true, messageId: "msg-1" })),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------
const STAFF_USER = {
  id: "staff-111",
  email: "staff@opollo.com",
  full_name: "Opollo Staff",
  is_opollo_staff: true,
};

function makeDbMock(
  staffRows: typeof STAFF_USER[],
  opts?: { staffError?: string },
) {
  return {
    from: (table: string) => {
      if (table === "platform_users") {
        return {
          select: () => ({
            eq: (_col: string, _val: unknown) => ({
              // Called by resolveOpolloAdmins (is_opollo_staff=true)
              // and by writeInAppRows (insert path, not reached here)
              in: () =>
                Promise.resolve({ data: staffRows, error: null }),
              // primary is_opollo_staff query
              // vitest can't distinguish which .eq() branch this is,
              // so we return the staffRows for all queries on platform_users.
              data: opts?.staffError ? null : staffRows,
              error: opts?.staffError
                ? { message: opts.staffError }
                : null,
            }),
          }),
        };
      }
      if (table === "platform_notifications") {
        return {
          insert: () => ({
            select: () =>
              Promise.resolve({ data: [{ id: "notif-1" }], error: null }),
          }),
        };
      }
      return {};
    },
  };
}

// Build a stub that resolves properly for resolveOpolloAdmins:
// `.from("platform_users").select("id, email, full_name").eq("is_opollo_staff", true)`
function makeStaffOnlyDbMock(
  staffRows: { id: string; email: string; full_name: string | null }[],
  dbError?: string,
) {
  return {
    from: (table: string) => {
      if (table === "platform_users") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: dbError ? null : staffRows,
                error: dbError ? { message: dbError } : null,
              }),
            in: () =>
              Promise.resolve({ data: staffRows, error: null }),
          }),
        };
      }
      if (table === "platform_notifications") {
        return {
          insert: () => ({
            select: () =>
              Promise.resolve({ data: [{ id: "notif-1" }], error: null }),
          }),
        };
      }
      return {};
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("resolveOpolloAdmins — empty-set guard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("throws when platform_users has no is_opollo_staff rows", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeStaffOnlyDbMock([]) as never,
    );

    const { resolveOpolloAdmins } = await import(
      "@/lib/platform/notifications/recipients"
    );
    await expect(resolveOpolloAdmins()).rejects.toThrow(
      /no Opollo staff in platform_users/,
    );
  });

  it("throws when the DB query errors rather than returning []", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeStaffOnlyDbMock([], "connection timeout") as never,
    );

    const { resolveOpolloAdmins } = await import(
      "@/lib/platform/notifications/recipients"
    );
    await expect(resolveOpolloAdmins()).rejects.toThrow(/connection timeout/);
  });

  it("returns >=1 recipient when staff exists", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeStaffOnlyDbMock([
        { id: "staff-1", email: "a@opollo.com", full_name: "A" },
        { id: "staff-2", email: "b@opollo.com", full_name: "B" },
      ]) as never,
    );

    const { resolveOpolloAdmins } = await import(
      "@/lib/platform/notifications/recipients"
    );
    const result = await resolveOpolloAdmins();
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].email).toBe("a@opollo.com");
  });
});

// ---------------------------------------------------------------------------
// dispatch — blocker ticket_created guarantee
// ---------------------------------------------------------------------------
describe("dispatch ticket_created (blocker) — >=1 recipient guarantee", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("sends email to >=1 staff recipient for a blocker ticket", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeStaffOnlyDbMock([
        { id: "staff-1", email: "on-call@opollo.com", full_name: "On Call" },
      ]) as never,
    );

    vi.resetModules();
    const { dispatch } = await import(
      "@/lib/platform/notifications/dispatch"
    );
    const { sendEmail } = await import("@/lib/email/sendgrid");

    const result = await dispatch({
      event: "ticket_created",
      companyId: "company-abc",
      ticketId: "ticket-123",
      ticketTitle: "Payment page crashes on submit",
      severity: "blocker",
      reporterUserId: "user-1",
    });

    // Email sent to the one Opollo staff member.
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: "on-call@opollo.com" }),
    );
    expect(result.emails).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("records an error in the DispatchResult AND captures to Sentry when no staff exist", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeStaffOnlyDbMock([]) as never,
    );

    vi.resetModules();
    const { dispatch } = await import(
      "@/lib/platform/notifications/dispatch"
    );
    const { sendEmail } = await import("@/lib/email/sendgrid");
    const Sentry = await import("@sentry/nextjs");

    // dispatch must NOT throw — it should return a result with errors[]
    await expect(
      dispatch({
        event: "ticket_created",
        companyId: "company-abc",
        ticketId: "ticket-456",
        ticketTitle: "Broken widget",
        severity: "blocker",
        reporterUserId: "user-2",
      }),
    ).resolves.toMatchObject({
      emails: 0,
      inApp: 0,
      errors: expect.arrayContaining([
        expect.objectContaining({ recipient: "resolve_recipients" }),
      ]),
    });

    // No email was sent.
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();

    // Sentry must have been notified so on-call is paged.
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({
          component: "notifications.dispatch",
          event: "ticket_created",
        }),
      }),
    );
  });

  it("resolves to >=1 recipient even when no staff are company admins (company-agnostic lookup)", async () => {
    // This test proves the guarantee holds regardless of company admin
    // assignments. ticket_created uses resolveOpolloAdmins which queries
    // ALL platform_users.is_opollo_staff, not company_users.
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeStaffOnlyDbMock([
        { id: "global-staff", email: "global@opollo.com", full_name: null },
      ]) as never,
    );

    vi.resetModules();
    const { dispatch } = await import(
      "@/lib/platform/notifications/dispatch"
    );
    const { sendEmail } = await import("@/lib/email/sendgrid");

    const result = await dispatch({
      event: "ticket_created",
      companyId: "company-with-no-opollo-admin-members",
      ticketId: "ticket-789",
      ticketTitle: "Critical bug",
      severity: "blocker",
      reporterUserId: "user-3",
    });

    expect(result.emails).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledWith(
      expect.objectContaining({ to: "global@opollo.com" }),
    );
    expect(result.errors).toHaveLength(0);
  });
});
