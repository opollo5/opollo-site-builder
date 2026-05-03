import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn(async (_input: { to: string }) => ({
    ok: true as const,
    messageId: `mock-${_input.to}`,
  })),
}));

import { sendEmail } from "@/lib/email/sendgrid";
import { dispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-55 — approval_decided notification with optional comment.
//
// S1-52 wired comment into approval_decided for changes_requested decisions.
// S1-54 extended the same to rejected decisions. Both decisions should use
// the comment as the notification body when present, and fall back to a
// default message when absent.
//
// sendEmail is mocked — no real SendGrid calls from CI.
// ---------------------------------------------------------------------------

const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;

const COMPANY_ID = "abcdef55-0000-0000-0000-apprv0decis0";
const POST_ID = "00000000-0000-0000-0000-000000000055";

describe("S1-55 approval_decided notification — comment routing", () => {
  let submitter: SeededAuthUser;
  let admin: SeededAuthUser;

  beforeAll(async () => {
    submitter = await seedAuthUser({
      email: "s1-55-submitter@opollo.test",
      persistent: true,
    });
    admin = await seedAuthUser({
      email: "s1-55-admin@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    mockSendEmail.mockClear();

    const svc = getServiceRoleClient();

    const co = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "S1-55 Approver Decision Co",
        slug: "s1-55-appr-dec",
        domain: "s1-55-appr-dec.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      })
      .select("id");
    if (co.error) throw new Error(`seed company: ${co.error.message}`);

    const users = await svc
      .from("platform_users")
      .insert([
        { id: submitter.id, email: submitter.email, full_name: "Submitter", is_opollo_staff: false },
        { id: admin.id, email: admin.email, full_name: "Admin", is_opollo_staff: false },
      ])
      .select("id");
    if (users.error) throw new Error(`seed users: ${users.error.message}`);

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_ID, user_id: submitter.id, role: "editor" },
        { company_id: COMPANY_ID, user_id: admin.id, role: "admin" },
      ])
      .select("id");
    if (memberships.error) throw new Error(`seed memberships: ${memberships.error.message}`);
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (submitter) await svc.auth.admin.deleteUser(submitter.id);
    if (admin) await svc.auth.admin.deleteUser(admin.id);
  });

  // -------------------------------------------------------------------------
  // rejected decision — with and without comment
  // -------------------------------------------------------------------------

  describe("decision: rejected", () => {
    it("creates in-app notification for the submitter", async () => {
      const svc = getServiceRoleClient();
      const before = await svc
        .from("platform_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", submitter.id)
        .eq("company_id", COMPANY_ID);

      const result = await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "rejected",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.inApp).toBeGreaterThan(0);

      const after = await svc
        .from("platform_notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", submitter.id)
        .eq("company_id", COMPANY_ID);
      expect((after.count ?? 0)).toBeGreaterThan(before.count ?? 0);
    });

    it("sends email to submitter + admins when rejected", async () => {
      await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "rejected",
      });

      const recipients = (mockSendEmail.mock.calls as Array<[{ to: string }]>).map((c) => c[0].to);
      expect(recipients).toContain(submitter.email);
    });

    it("uses comment as notification body when provided with rejected", async () => {
      await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "rejected",
        comment: "Brand guidelines violated on paragraph 2.",
      });

      const calls = mockSendEmail.mock.calls as Array<[{ html: string }]>;
      const allHtml = calls.map((c) => c[0].html).join(" ");
      expect(allHtml).toContain("Brand guidelines violated on paragraph 2.");
    });

    it("falls back to default body when rejected has no comment", async () => {
      await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "rejected",
      });

      const calls = mockSendEmail.mock.calls as Array<[{ html: string }]>;
      const allHtml = calls.map((c) => c[0].html).join(" ");
      expect(allHtml).toContain("rejected");
    });
  });

  // -------------------------------------------------------------------------
  // changes_requested decision — with and without comment
  // -------------------------------------------------------------------------

  describe("decision: changes_requested", () => {
    it("uses comment as notification body when provided", async () => {
      await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "changes_requested",
        comment: "Please shorten the headline.",
      });

      const calls = mockSendEmail.mock.calls as Array<[{ html: string }]>;
      const allHtml = calls.map((c) => c[0].html).join(" ");
      expect(allHtml).toContain("Please shorten the headline.");
    });

    it("falls back to default body when changes_requested has no comment", async () => {
      await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "changes_requested",
      });

      const calls = mockSendEmail.mock.calls as Array<[{ html: string }]>;
      const allHtml = calls.map((c) => c[0].html).join(" ");
      expect(allHtml).toContain("changes_requested");
    });
  });

  // -------------------------------------------------------------------------
  // approved decision — always uses standard body (no comment supported)
  // -------------------------------------------------------------------------

  describe("decision: approved", () => {
    it("sends notification to submitter on approval", async () => {
      const result = await dispatch({
        event: "approval_decided",
        companyId: COMPANY_ID,
        postMasterId: POST_ID,
        submitterUserId: submitter.id,
        decision: "approved",
      });

      expect(result.errors).toHaveLength(0);
      const recipients = (mockSendEmail.mock.calls as Array<[{ to: string }]>).map((c) => c[0].to);
      expect(recipients).toContain(submitter.email);
    });
  });
});
