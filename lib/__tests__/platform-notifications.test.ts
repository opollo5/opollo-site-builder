import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock the email send so dispatch doesn't fire real SendGrid requests
// from CI. Each test inspects the mock to assert the right messages
// were attempted.
vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn(async (_input: { to: string }) => ({
    ok: true as const,
    messageId: `mock-${_input.to}`,
  })),
}));

import { sendEmail } from "@/lib/email/sendgrid";
import {
  dedupeByEmail,
  dispatch,
  EVENT_CHANNELS,
  resolveCompanyAdmins,
  resolveOpolloAdmins,
} from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const COMPANY_B_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

describe("lib/platform/notifications", () => {
  let admin1: SeededAuthUser;
  let admin2: SeededAuthUser;
  let editor: SeededAuthUser;
  let approver: SeededAuthUser;
  let opolloStaff: SeededAuthUser;
  let bAdmin: SeededAuthUser;

  beforeAll(async () => {
    admin1 = await seedAuthUser({
      email: "p5-admin1@opollo.test",
      persistent: true,
    });
    admin2 = await seedAuthUser({
      email: "p5-admin2@opollo.test",
      persistent: true,
    });
    editor = await seedAuthUser({
      email: "p5-editor@opollo.test",
      persistent: true,
    });
    approver = await seedAuthUser({
      email: "p5-approver@opollo.test",
      persistent: true,
    });
    opolloStaff = await seedAuthUser({
      email: "p5-staff@opollo.test",
      persistent: true,
    });
    bAdmin = await seedAuthUser({
      email: "p5-b-admin@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    mockSendEmail.mockClear();

    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "p5-acme",
          domain: "p5-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "p5-beta",
          domain: "p5-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const users = await svc
      .from("platform_users")
      .insert([
        {
          id: admin1.id,
          email: admin1.email,
          full_name: "Admin One",
          is_opollo_staff: false,
        },
        {
          id: admin2.id,
          email: admin2.email,
          full_name: "Admin Two",
          is_opollo_staff: false,
        },
        {
          id: editor.id,
          email: editor.email,
          full_name: "Editor",
          is_opollo_staff: false,
        },
        {
          id: approver.id,
          email: approver.email,
          full_name: "Approver",
          is_opollo_staff: false,
        },
        {
          id: opolloStaff.id,
          email: opolloStaff.email,
          full_name: "Opollo Staff",
          is_opollo_staff: true,
        },
        {
          id: bAdmin.id,
          email: bAdmin.email,
          full_name: "B Admin",
          is_opollo_staff: false,
        },
      ])
      .select("id");
    if (users.error) {
      throw new Error(
        `seed users: ${users.error.code ?? "?"} ${users.error.message}`,
      );
    }

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_A_ID, user_id: admin1.id, role: "admin" },
        { company_id: COMPANY_A_ID, user_id: admin2.id, role: "admin" },
        { company_id: COMPANY_A_ID, user_id: editor.id, role: "editor" },
        { company_id: COMPANY_A_ID, user_id: approver.id, role: "approver" },
        { company_id: COMPANY_B_ID, user_id: bAdmin.id, role: "admin" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(
        `seed memberships: ${memberships.error.code ?? "?"} ${memberships.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [admin1, admin2, editor, approver, opolloStaff, bAdmin]) {
      if (!u) continue;
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  // -------------------------------------------------------------------------
  // EVENT_CHANNELS — mirrors BUILD.md's trigger table.
  // -------------------------------------------------------------------------

  describe("EVENT_CHANNELS", () => {
    it("invitation_sent / reminder / expired are email-only", () => {
      expect(EVENT_CHANNELS.invitation_sent).toEqual(["email"]);
      expect(EVENT_CHANNELS.invitation_reminder).toEqual(["email"]);
      expect(EVENT_CHANNELS.invitation_expired).toEqual(["email"]);
    });
    it("connection_restored / post_published are in_app-only", () => {
      expect(EVENT_CHANNELS.connection_restored).toEqual(["in_app"]);
      expect(EVENT_CHANNELS.post_published).toEqual(["in_app"]);
    });
    it("approval_decided / connection_lost / post_failed are dual-channel", () => {
      expect(EVENT_CHANNELS.approval_decided).toEqual(["email", "in_app"]);
      expect(EVENT_CHANNELS.connection_lost).toEqual(["email", "in_app"]);
      expect(EVENT_CHANNELS.post_failed).toEqual(["email", "in_app"]);
    });
  });

  // -------------------------------------------------------------------------
  // Recipient resolvers.
  // -------------------------------------------------------------------------

  describe("recipient resolvers", () => {
    it("resolveCompanyAdmins returns admins of own company only", async () => {
      const list = await resolveCompanyAdmins(COMPANY_A_ID);
      const emails = list.map((r) => r.email).sort();
      expect(emails).toEqual([admin1.email, admin2.email].sort());
    });

    it("resolveCompanyAdmins is empty for a company with no admins", async () => {
      const svc = getServiceRoleClient();
      const adminLessId = "ffffffff-ffff-ffff-ffff-eeeeeeeeeeee";
      await svc.from("platform_companies").insert({
        id: adminLessId,
        name: "No Admins",
        slug: "p5-no-admins",
        domain: null,
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
      });

      const list = await resolveCompanyAdmins(adminLessId);
      expect(list).toEqual([]);
    });

    it("resolveOpolloAdmins includes platform_users with is_opollo_staff=true", async () => {
      const list = await resolveOpolloAdmins();
      const emails = list.map((r) => r.email);
      expect(emails).toContain(opolloStaff.email);
    });

    it("dedupeByEmail collapses repeats case-insensitively", () => {
      const result = dedupeByEmail([
        { userId: "u1", email: "A@example.com", fullName: null },
        { userId: "u2", email: "a@example.com", fullName: null },
        { userId: "u3", email: "b@example.com", fullName: null },
      ]);
      expect(result).toHaveLength(2);
      expect(result[0]?.email).toBe("A@example.com");
    });
  });

  // -------------------------------------------------------------------------
  // dispatch — fan-out + in-app + email channels.
  // -------------------------------------------------------------------------

  describe("dispatch", () => {
    it("invitation_accepted writes in-app rows for inviter+admins, sends email to all", async () => {
      const result = await dispatch({
        event: "invitation_accepted",
        companyId: COMPANY_A_ID,
        inviteeEmail: "newperson@acme.test",
        inviteeUserId: editor.id,
        inviterUserId: admin1.id,
      });

      // Recipients = inviter (admin1) + admins (admin1, admin2). Dedupe
      // collapses admin1 → 2 unique recipients.
      expect(result.errors).toEqual([]);
      expect(result.inApp).toBe(2);
      expect(result.emails).toBe(2);

      // Verify in-app rows exist.
      const svc = getServiceRoleClient();
      const rows = await svc
        .from("platform_notifications")
        .select("user_id, type, title")
        .eq("company_id", COMPANY_A_ID)
        .eq("type", "invitation_accepted");
      expect(rows.error).toBeNull();
      expect(rows.data?.length).toBe(2);
      const userIds = (rows.data ?? []).map((r) => r.user_id).sort();
      expect(userIds).toEqual([admin1.id, admin2.id].sort());

      // Email send was called twice (admin1 + admin2 unique).
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
    });

    it("approval_requested fans out to admins+approvers, not editors/viewers", async () => {
      const result = await dispatch({
        event: "approval_requested",
        companyId: COMPANY_A_ID,
        postMasterId: "00000000-0000-0000-0000-000000000aaa",
        submitterUserId: editor.id,
      });

      // admin1 + admin2 + approver = 3 recipients. Editor excluded.
      expect(result.errors).toEqual([]);
      expect(result.inApp).toBe(3);
      expect(result.emails).toBe(3);

      const sentTo = mockSendEmail.mock.calls
        .map((c) => (c[0] as { to: string }).to)
        .sort();
      expect(sentTo).toEqual(
        [admin1.email, admin2.email, approver.email].sort(),
      );
    });

    it("connection_restored is in_app-only — zero emails", async () => {
      const result = await dispatch({
        event: "connection_restored",
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
      });

      expect(result.errors).toEqual([]);
      expect(result.inApp).toBe(2); // admin1 + admin2
      expect(result.emails).toBe(0);
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("invitation_sent is email-only to invitee — zero in_app", async () => {
      const result = await dispatch({
        event: "invitation_sent",
        companyId: COMPANY_A_ID,
        inviteeEmail: "external@nowhere.test",
        inviterUserId: admin1.id,
        acceptUrl: "https://app.opollo.com/invite/abc",
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      });

      expect(result.errors).toEqual([]);
      expect(result.inApp).toBe(0); // recipient has no userId
      expect(result.emails).toBe(1);
      expect(mockSendEmail.mock.calls[0]?.[0]).toMatchObject({
        to: "external@nowhere.test",
      });
    });

    it("connection_lost includes opollo staff + company admins", async () => {
      const result = await dispatch({
        event: "connection_lost",
        companyId: COMPANY_A_ID,
        platform: "facebook_page",
        reason: "token expired",
      });

      // admin1 + admin2 + opolloStaff = 3 unique platform users
      expect(result.errors).toEqual([]);
      expect(result.inApp).toBe(3);
      expect(result.emails).toBe(3);
    });

    it("dispatch never throws — surfaces errors via result envelope", async () => {
      mockSendEmail.mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "SENDGRID_REJECTED",
          message: "test failure",
        },
      });

      const result = await dispatch({
        event: "approval_decided",
        companyId: COMPANY_A_ID,
        postMasterId: "00000000-0000-0000-0000-000000000bbb",
        submitterUserId: editor.id,
        decision: "approved",
      });

      // Submitter (editor) + admin1 + admin2 = 3 recipients. One email
      // rejected; two succeed.
      expect(result.emails).toBe(2);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(result.errors[0]?.reason).toContain("test failure");
    });

    it("does not leak across companies — company B admin not notified for A's events", async () => {
      await dispatch({
        event: "invitation_accepted",
        companyId: COMPANY_A_ID,
        inviteeEmail: "newperson@acme.test",
        inviteeUserId: editor.id,
        inviterUserId: admin1.id,
      });

      const sentTo = mockSendEmail.mock.calls.map(
        (c) => (c[0] as { to: string }).to,
      );
      expect(sentTo).not.toContain(bAdmin.email);
    });
  });
});
