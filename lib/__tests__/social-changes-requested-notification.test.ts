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

import { dispatch } from "@/lib/platform/notifications";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-31 — changes_requested notification event.
//
// When a reviewer requests changes the dedicated changes_requested event
// fires (not approval_decided), so the in-app title reads
// "Changes requested on your post" and the comment is surfaced.
//
// We test the dispatch layer directly — the decision route branching is
// covered by a typecheck-enforced exhaustive switch.
// ---------------------------------------------------------------------------

const COMPANY_ID = "abcdef31-0000-0000-0000-chng0000req0";

describe("S1-31 changes_requested notification", () => {
  let submitter: SeededAuthUser;
  let admin: SeededAuthUser;

  beforeAll(async () => {
    submitter = await seedAuthUser({
      email: "s1-31-submitter@opollo.test",
      persistent: true,
    });
    admin = await seedAuthUser({
      email: "s1-31-admin@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const co = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "S1-31 ChangesReq Co",
        slug: "s1-31-changesreq",
        domain: "s1-31-changesreq.test",
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
    if (memberships.error) {
      throw new Error(`seed memberships: ${memberships.error.message}`);
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (submitter) await svc.auth.admin.deleteUser(submitter.id);
    if (admin) await svc.auth.admin.deleteUser(admin.id);
  });

  async function countNotifications(recipientId: string): Promise<number> {
    const svc = getServiceRoleClient();
    const r = await svc
      .from("platform_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", recipientId)
      .eq("company_id", COMPANY_ID);
    return r.count ?? 0;
  }

  it("creates in-app notification for the submitter with comment", async () => {
    const before = await countNotifications(submitter.id);

    const result = await dispatch({
      event: "changes_requested",
      companyId: COMPANY_ID,
      postMasterId: "00000000-0000-0000-0000-000000000031",
      submitterUserId: submitter.id,
      comment: "Please fix the headline.",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.inApp).toBeGreaterThan(0);

    const after = await countNotifications(submitter.id);
    expect(after).toBeGreaterThan(before);
  });

  it("fires an email to the submitter", async () => {
    const { sendEmail } = await import("@/lib/email/sendgrid");
    const mockSend = sendEmail as unknown as ReturnType<typeof vi.fn>;
    mockSend.mockClear();

    await dispatch({
      event: "changes_requested",
      companyId: COMPANY_ID,
      postMasterId: "00000000-0000-0000-0000-000000000031",
      submitterUserId: submitter.id,
      comment: "Add more detail to the CTA.",
    });

    const calls = mockSend.mock.calls as Array<[{ to: string }]>;
    const recipients = calls.map((c) => c[0].to);
    expect(recipients).toContain(submitter.email);
  });
});
