import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock sendEmail so approval/failure emails don't fire real SendGrid calls.
vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn(async (_input: { to: string }) => ({
    ok: true as const,
    messageId: `mock-${_input.to}`,
  })),
}));

import { dispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-27 — notification dispatch wiring tests.
//
// Verifies that the notification payloads fired from the submit route
// (approval_requested) and the webhook handler (post_failed) actually
// land in platform_notifications (in-app channel) and trigger email
// sends when recipients exist.
//
// sendEmail is mocked — no real SendGrid calls from CI.
// ---------------------------------------------------------------------------

const COMPANY_ID = "abcdef27-0000-0000-0000-not1fwir1ng0";

describe("S1-27 notification wiring", () => {
  let admin: SeededAuthUser;
  let submitter: SeededAuthUser;

  beforeAll(async () => {
    admin = await seedAuthUser({
      email: "s1-27-admin@opollo.test",
      persistent: true,
    });
    submitter = await seedAuthUser({
      email: "s1-27-submitter@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const co = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "S1-27 Notif Co",
        slug: "s1-27-notif",
        domain: "s1-27-notif.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      })
      .select("id");
    if (co.error) throw new Error(`seed company: ${co.error.message}`);

    const users = await svc
      .from("platform_users")
      .insert([
        { id: admin.id, email: admin.email, full_name: "Admin", is_opollo_staff: false },
        { id: submitter.id, email: submitter.email, full_name: "Submitter", is_opollo_staff: false },
      ])
      .select("id");
    if (users.error) throw new Error(`seed users: ${users.error.message}`);

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_ID, user_id: admin.id, role: "admin" },
        { company_id: COMPANY_ID, user_id: submitter.id, role: "editor" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(`seed memberships: ${memberships.error.message}`);
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (admin) await svc.auth.admin.deleteUser(admin.id);
    if (submitter) await svc.auth.admin.deleteUser(submitter.id);
  });

  async function countNotifications(recipientId: string): Promise<number> {
    const svc = getServiceRoleClient();
    const r = await svc
      .from("platform_notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_user_id", recipientId)
      .eq("company_id", COMPANY_ID);
    return r.count ?? 0;
  }

  describe("approval_requested", () => {
    it("creates in-app notification for company admins", async () => {
      const beforeCount = await countNotifications(admin.id);

      const result = await dispatch({
        event: "approval_requested",
        companyId: COMPANY_ID,
        postMasterId: "00000000-0000-0000-0000-000000000027",
        submitterUserId: submitter.id,
      });

      expect(result.errors).toHaveLength(0);
      expect(result.inApp).toBeGreaterThan(0);

      const afterCount = await countNotifications(admin.id);
      expect(afterCount).toBeGreaterThan(beforeCount);
    });

    it("fires an email to company admins", async () => {
      const { sendEmail } = await import("@/lib/email/sendgrid");
      const mockSend = sendEmail as unknown as ReturnType<typeof vi.fn>;
      mockSend.mockClear();

      await dispatch({
        event: "approval_requested",
        companyId: COMPANY_ID,
        postMasterId: "00000000-0000-0000-0000-000000000027",
        submitterUserId: submitter.id,
      });

      const calls = mockSend.mock.calls as Array<[{ to: string }]>;
      const recipients = calls.map((c) => c[0].to);
      expect(recipients).toContain(admin.email);
    });
  });

  describe("post_failed", () => {
    it("creates in-app notification for company admins", async () => {
      const beforeCount = await countNotifications(admin.id);

      const result = await dispatch({
        event: "post_failed",
        companyId: COMPANY_ID,
        postMasterId: "00000000-0000-0000-0000-000000000027",
        submitterUserId: submitter.id,
        platform: "linkedin_personal",
        errorClass: "auth_failure",
        errorMessage: "Token expired.",
      });

      expect(result.errors).toHaveLength(0);
      expect(result.inApp).toBeGreaterThan(0);

      const afterCount = await countNotifications(admin.id);
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });
});
