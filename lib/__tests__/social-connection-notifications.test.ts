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
// S1-30 — connection_lost / connection_restored notification wiring.
//
// dispatch() is called directly (same shape as the webhook handler calls
// it). Verifies that in-app rows land in platform_notifications for
// company admins when a connection is lost or restored.
// ---------------------------------------------------------------------------

const COMPANY_ID = "abcdef30-0000-0000-0000-c0nnlost0000";

describe("S1-30 connection notification wiring", () => {
  let admin: SeededAuthUser;

  beforeAll(async () => {
    admin = await seedAuthUser({
      email: "s1-30-admin@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const co = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "S1-30 Conn Co",
        slug: "s1-30-conn",
        domain: "s1-30-conn.test",
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
      ])
      .select("id");
    if (users.error) throw new Error(`seed users: ${users.error.message}`);

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_ID, user_id: admin.id, role: "admin" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(`seed memberships: ${memberships.error.message}`);
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
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

  it("connection_lost creates in-app notification for company admins", async () => {
    const before = await countNotifications(admin.id);

    const result = await dispatch({
      event: "connection_lost",
      companyId: COMPANY_ID,
      platform: "linkedin_personal",
      reason: "Token expired.",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.inApp).toBeGreaterThan(0);

    const after = await countNotifications(admin.id);
    expect(after).toBeGreaterThan(before);
  });

  it("connection_restored creates in-app notification for company admins", async () => {
    const before = await countNotifications(admin.id);

    const result = await dispatch({
      event: "connection_restored",
      companyId: COMPANY_ID,
      platform: "twitter",
    });

    expect(result.errors).toHaveLength(0);
    expect(result.inApp).toBeGreaterThan(0);

    const after = await countNotifications(admin.id);
    expect(after).toBeGreaterThan(before);
  });
});
