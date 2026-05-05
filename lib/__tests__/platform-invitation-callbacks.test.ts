import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Mock SendGrid so the dispatcher's email side-effect is observable in
// the test without firing real network requests. Each test inspects
// the mock to verify the right number of emails went out.
vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn(async (_input: { to: string }) => ({
    ok: true as const,
    messageId: `mock-${_input.to}`,
  })),
}));

import { sendEmail } from "@/lib/email/sendgrid";
import {
  enqueueInvitationCallbacks,
  generateRawToken,
  handleExpiryCallback,
  handleReminderCallback,
  hashToken,
} from "@/lib/platform/invitations";
import { __resetQstashForTests } from "@/lib/qstash";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

const mockSendEmail = sendEmail as unknown as ReturnType<typeof vi.fn>;

const COMPANY_A_ID = "abababab-abab-abab-abab-abababababab";

async function insertInvitation(args: {
  companyId: string;
  email: string;
  invitedBy: string | null;
  status?: "pending" | "accepted" | "revoked" | "expired";
  expiresAt?: string;
  reminderSentAt?: string | null;
  expiredNotifiedAt?: string | null;
  acceptedAt?: string | null;
  acceptedUserId?: string | null;
  revokedAt?: string | null;
}): Promise<{ id: string; rawToken: string }> {
  const svc = getServiceRoleClient();
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt =
    args.expiresAt ??
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const insert = await svc
    .from("platform_invitations")
    .insert({
      company_id: args.companyId,
      email: args.email,
      role: "editor",
      token_hash: tokenHash,
      status: args.status ?? "pending",
      expires_at: expiresAt,
      invited_by: args.invitedBy,
      reminder_sent_at: args.reminderSentAt ?? null,
      expired_notified_at: args.expiredNotifiedAt ?? null,
      accepted_at: args.acceptedAt ?? null,
      accepted_user_id: args.acceptedUserId ?? null,
      revoked_at: args.revokedAt ?? null,
    })
    .select("id")
    .single();
  if (insert.error) {
    throw new Error(
      `insertInvitation: ${insert.error.code ?? "?"} ${insert.error.message}`,
    );
  }
  return { id: insert.data.id as string, rawToken };
}

async function readInvitation(id: string) {
  const svc = getServiceRoleClient();
  const r = await svc
    .from("platform_invitations")
    .select(
      "id, status, reminder_sent_at, expired_notified_at, accepted_at, revoked_at",
    )
    .eq("id", id)
    .single();
  if (r.error) throw new Error(`readInvitation: ${r.error.message}`);
  return r.data;
}

describe("lib/platform/invitations/callbacks", () => {
  let inviter: SeededAuthUser;

  beforeAll(async () => {
    inviter = await seedAuthUser({
      email: "p2-4-inviter@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    mockSendEmail.mockClear();
    __resetQstashForTests();

    const svc = getServiceRoleClient();
    const company = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_A_ID,
        name: "Acme Co",
        slug: "p2-4-acme",
        domain: "p2-4-acme.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
      })
      .select("id");
    if (company.error) {
      throw new Error(
        `seed company: ${company.error.code ?? "?"} ${company.error.message}`,
      );
    }

    const user = await svc
      .from("platform_users")
      .insert({
        id: inviter.id,
        email: inviter.email,
        full_name: "Inviter",
        is_opollo_staff: false,
      })
      .select("id");
    if (user.error) {
      throw new Error(
        `seed inviter: ${user.error.code ?? "?"} ${user.error.message}`,
      );
    }

    const membership = await svc
      .from("platform_company_users")
      .insert({
        company_id: COMPANY_A_ID,
        user_id: inviter.id,
        role: "admin",
      })
      .select("id");
    if (membership.error) {
      throw new Error(
        `seed membership: ${membership.error.code ?? "?"} ${membership.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (inviter) await svc.auth.admin.deleteUser(inviter.id);
  });

  describe("handleReminderCallback", () => {
    it("happy path — dispatches reminder + stamps reminder_sent_at", async () => {
      const { id, rawToken } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "newhire@acme.test",
        invitedBy: inviter.id,
      });

      const result = await handleReminderCallback({
        invitationId: id,
        rawToken,
      });

      expect(result.outcome).toBe("dispatched");
      // invitation_reminder is email-only with one recipient (the invitee).
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
      expect(mockSendEmail.mock.calls[0]?.[0]).toMatchObject({
        to: "newhire@acme.test",
      });

      const row = await readInvitation(id);
      expect(row.reminder_sent_at).not.toBeNull();
      expect(row.status).toBe("pending");
    });

    it("idempotent — second fire is noop_already_handled, no second email", async () => {
      const { id, rawToken } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "dup-fire@acme.test",
        invitedBy: inviter.id,
      });

      const first = await handleReminderCallback({
        invitationId: id,
        rawToken,
      });
      expect(first.outcome).toBe("dispatched");
      expect(mockSendEmail).toHaveBeenCalledTimes(1);

      const second = await handleReminderCallback({
        invitationId: id,
        rawToken,
      });
      expect(second.outcome).toBe("noop_already_handled");
      // Mock was not called a second time — total stays 1.
      expect(mockSendEmail).toHaveBeenCalledTimes(1);
    });

    it("noop when invitation already accepted — does not email", async () => {
      const { id, rawToken } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "already-in@acme.test",
        invitedBy: inviter.id,
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        acceptedUserId: inviter.id,
      });

      const result = await handleReminderCallback({
        invitationId: id,
        rawToken,
      });
      expect(result.outcome).toBe("noop_not_pending");
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("noop when invitation revoked — does not email", async () => {
      const { id, rawToken } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "revoked@acme.test",
        invitedBy: inviter.id,
        status: "revoked",
        revokedAt: new Date().toISOString(),
      });

      const result = await handleReminderCallback({
        invitationId: id,
        rawToken,
      });
      expect(result.outcome).toBe("noop_not_pending");
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("noop when invitation does not exist", async () => {
      const result = await handleReminderCallback({
        invitationId: "00000000-0000-0000-0000-000000000999",
      });
      expect(result.outcome).toBe("noop_not_found");
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe("handleExpiryCallback", () => {
    it("happy path — flips status to expired + dispatches notification", async () => {
      const { id } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "expired@acme.test",
        invitedBy: inviter.id,
      });

      const result = await handleExpiryCallback({ invitationId: id });
      expect(result.outcome).toBe("dispatched");

      // invitation_expired is email-only; recipients = invitee + inviter.
      // Inviter exists in this test, so 2 sends.
      expect(mockSendEmail).toHaveBeenCalledTimes(2);
      const recipients = mockSendEmail.mock.calls
        .map((c) => (c[0] as { to: string }).to)
        .sort();
      expect(recipients).toEqual(
        ["expired@acme.test", inviter.email].sort(),
      );

      const row = await readInvitation(id);
      expect(row.status).toBe("expired");
      expect(row.expired_notified_at).not.toBeNull();
    });

    it("idempotent — second fire is noop_already_handled, no second email batch", async () => {
      const { id } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "dup-expiry@acme.test",
        invitedBy: inviter.id,
      });

      const first = await handleExpiryCallback({ invitationId: id });
      expect(first.outcome).toBe("dispatched");
      const callsAfterFirst = mockSendEmail.mock.calls.length;

      const second = await handleExpiryCallback({ invitationId: id });
      expect(second.outcome).toBe("noop_already_handled");
      expect(mockSendEmail).toHaveBeenCalledTimes(callsAfterFirst);
    });

    it("noop when invitation already accepted — status stays accepted, no email", async () => {
      const { id } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "early-accept@acme.test",
        invitedBy: inviter.id,
        status: "accepted",
        acceptedAt: new Date().toISOString(),
        acceptedUserId: inviter.id,
      });

      const result = await handleExpiryCallback({ invitationId: id });
      expect(result.outcome).toBe("noop_not_pending");
      expect(mockSendEmail).not.toHaveBeenCalled();

      const row = await readInvitation(id);
      expect(row.status).toBe("accepted");
      expect(row.expired_notified_at).toBeNull();
    });

    it("noop when invitation already revoked", async () => {
      const { id } = await insertInvitation({
        companyId: COMPANY_A_ID,
        email: "early-revoke@acme.test",
        invitedBy: inviter.id,
        status: "revoked",
        revokedAt: new Date().toISOString(),
      });

      const result = await handleExpiryCallback({ invitationId: id });
      expect(result.outcome).toBe("noop_not_pending");
      expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it("noop when invitation does not exist", async () => {
      const result = await handleExpiryCallback({
        invitationId: "00000000-0000-0000-0000-000000000aaa",
      });
      expect(result.outcome).toBe("noop_not_found");
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });

  describe("enqueueInvitationCallbacks", () => {
    it("no-ops when QSTASH_TOKEN is unset — returns null ids, does not throw", async () => {
      const original = process.env.QSTASH_TOKEN;
      delete process.env.QSTASH_TOKEN;
      __resetQstashForTests();
      try {
        const result = await enqueueInvitationCallbacks({
          invitationId: "00000000-0000-0000-0000-000000000bbb",
          rawToken: "irrelevant",
          expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
          origin: "https://example.test",
        });
        expect(result.reminderMessageId).toBeNull();
        expect(result.expiryMessageId).toBeNull();
      } finally {
        if (original !== undefined) process.env.QSTASH_TOKEN = original;
        __resetQstashForTests();
      }
    });
  });
});
