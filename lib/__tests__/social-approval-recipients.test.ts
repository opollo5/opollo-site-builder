import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { hashToken } from "@/lib/platform/invitations";
import {
  addRecipient,
  listRecipients,
  revokeRecipient,
} from "@/lib/platform/social/approvals";
import {
  createPostMaster,
  submitForApproval,
} from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-6: lib-layer tests for approval recipients (add / list / revoke).
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-111111111111";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-222222222222";

describe("lib/platform/social/approvals/recipients", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-6-creator@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "s1-6-acme",
          domain: "s1-6-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-6-beta",
          domain: "s1-6-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const user = await svc
      .from("platform_users")
      .insert({
        id: creator.id,
        email: creator.email,
        full_name: "Creator",
        is_opollo_staff: false,
      })
      .select("id");
    if (user.error) {
      throw new Error(
        `seed creator: ${user.error.code ?? "?"} ${user.error.message}`,
      );
    }

    const membership = await svc
      .from("platform_company_users")
      .insert({
        company_id: COMPANY_A_ID,
        user_id: creator.id,
        role: "editor",
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
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  // Set up an open approval_request for company A to operate against.
  async function createOpenRequest(): Promise<string> {
    const post = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "ready for review",
      createdBy: creator.id,
    });
    if (!post.ok) throw new Error(`createOpenRequest: post ${post.error.code}`);
    const submitted = await submitForApproval({
      postId: post.data.id,
      companyId: COMPANY_A_ID,
    });
    if (!submitted.ok) {
      throw new Error(`createOpenRequest: submit ${submitted.error.code}`);
    }
    return submitted.data.approvalRequestId;
  }

  describe("addRecipient", () => {
    it("happy path — inserts a recipient and returns a raw token + hashed token in DB", async () => {
      const requestId = await createOpenRequest();
      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "Reviewer@External.Test",
        name: "Rita Reviewer",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Email normalised to lowercase + trimmed.
      expect(result.data.recipient.email).toBe("reviewer@external.test");
      expect(result.data.recipient.name).toBe("Rita Reviewer");
      expect(result.data.recipient.requires_otp).toBe(false);
      expect(result.data.rawToken).toMatch(/^[0-9a-f]{64}$/);

      // Confirm the hash on disk matches the raw token.
      const svc = getServiceRoleClient();
      const row = await svc
        .from("social_approval_recipients")
        .select("token_hash")
        .eq("id", result.data.recipient.id)
        .single();
      expect(row.error).toBeNull();
      expect(row.data?.token_hash).toBe(hashToken(result.data.rawToken));
      expect(row.data?.token_hash).not.toBe(result.data.rawToken);
    });

    it("normalises email — trims + lowercases", async () => {
      const requestId = await createOpenRequest();
      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "  Mixed@Acme.Test  ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.recipient.email).toBe("mixed@acme.test");
    });

    it("rejects bad email with VALIDATION_FAILED", async () => {
      const requestId = await createOpenRequest();
      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "not-an-email",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const requestId = await createOpenRequest();
      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_B_ID,
        email: "intruder@b.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rejects when the approval_request is revoked (INVALID_STATE)", async () => {
      const requestId = await createOpenRequest();
      const svc = getServiceRoleClient();
      await svc
        .from("social_approval_requests")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", requestId);

      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "late@external.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("rejects when the approval_request is finalised (INVALID_STATE)", async () => {
      const requestId = await createOpenRequest();
      const svc = getServiceRoleClient();
      await svc
        .from("social_approval_requests")
        .update({ final_approved_at: new Date().toISOString() })
        .eq("id", requestId);

      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "post-final@external.test",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("denormalises platform_user_id when recipient email matches a platform user", async () => {
      // Seed a platform user with a known email.
      const svc = getServiceRoleClient();
      const otherUser = await seedAuthUser({
        email: "linked-recipient@opollo.test",
      });
      const insertUser = await svc
        .from("platform_users")
        .insert({
          id: otherUser.id,
          email: otherUser.email,
          full_name: "Linked",
          is_opollo_staff: false,
        })
        .select("id");
      expect(insertUser.error).toBeNull();

      const requestId = await createOpenRequest();
      const result = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: otherUser.email,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.recipient.platform_user_id).toBe(otherUser.id);
    });
  });

  describe("listRecipients", () => {
    it("returns recipients for the open request, ordered by created_at asc", async () => {
      const requestId = await createOpenRequest();
      await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "first@external.test",
      });
      await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "second@external.test",
      });

      const result = await listRecipients({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const emails = result.data.recipients.map((r) => r.email);
      expect(emails).toEqual([
        "first@external.test",
        "second@external.test",
      ]);
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const requestId = await createOpenRequest();
      const result = await listRecipients({
        approvalRequestId: requestId,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("revokeRecipient", () => {
    it("happy path — sets revoked_at and returns the row", async () => {
      const requestId = await createOpenRequest();
      const added = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "revoke-target@external.test",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) return;

      const result = await revokeRecipient({
        recipientId: added.data.recipient.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.revoked_at).not.toBeNull();
    });

    it("returns ALREADY_REVOKED on the second call", async () => {
      const requestId = await createOpenRequest();
      const added = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "double-revoke@external.test",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) return;

      const first = await revokeRecipient({
        recipientId: added.data.recipient.id,
        companyId: COMPANY_A_ID,
      });
      expect(first.ok).toBe(true);
      const second = await revokeRecipient({
        recipientId: added.data.recipient.id,
        companyId: COMPANY_A_ID,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const requestId = await createOpenRequest();
      const added = await addRecipient({
        approvalRequestId: requestId,
        companyId: COMPANY_A_ID,
        email: "scoped@external.test",
      });
      expect(added.ok).toBe(true);
      if (!added.ok) return;

      const result = await revokeRecipient({
        recipientId: added.data.recipient.id,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });
});
