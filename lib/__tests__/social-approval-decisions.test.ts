import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  addRecipient,
  recordApprovalDecision,
  resolveRecipientByToken,
} from "@/lib/platform/social/approvals";
import {
  createPostMaster,
  submitForApproval,
} from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-7: lib-layer tests for the magic-link viewer + decision recorder.
//
// Exercises migration 0072's record_approval_decision Postgres function
// end-to-end. Concurrency invariant covered: two parallel approvals
// against an any_one rule must produce one finalised request, not two
// overlapping finalisations.
// ---------------------------------------------------------------------------

const ANY_ONE_COMPANY_ID = "abcdef00-0000-0000-0000-333333333333";
const ALL_MUST_COMPANY_ID = "abcdef00-0000-0000-0000-444444444444";

describe("lib/platform/social/approvals/decisions", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-7-creator@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: ANY_ONE_COMPANY_ID,
          name: "Acme Co",
          slug: "s1-7-acme",
          domain: "s1-7-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: ALL_MUST_COMPANY_ID,
          name: "Beta Inc",
          slug: "s1-7-beta",
          domain: "s1-7-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "all_must",
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

    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: ANY_ONE_COMPANY_ID, user_id: creator.id, role: "editor" },
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
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  // Helpers --------------------------------------------------------

  async function createSubmittedPost(args: {
    companyId: string;
  }): Promise<{ postId: string; requestId: string }> {
    let postId: string;
    if (args.companyId === ANY_ONE_COMPANY_ID) {
      const post = await createPostMaster({
        companyId: ANY_ONE_COMPANY_ID,
        masterText: "decide on me",
        createdBy: creator.id,
      });
      if (!post.ok) throw new Error(`createSubmittedPost: ${post.error.code}`);
      postId = post.data.id;
    } else {
      // creator isn't a member of all_must company; insert directly.
      const svc = getServiceRoleClient();
      const inserted = await svc
        .from("social_post_master")
        .insert({
          company_id: args.companyId,
          state: "draft",
          source_type: "manual",
          master_text: "decide on me (all_must)",
        })
        .select("id")
        .single();
      if (inserted.error) {
        throw new Error(`insert post: ${inserted.error.message}`);
      }
      postId = inserted.data.id as string;
    }

    const submitted = await submitForApproval({
      postId,
      companyId: args.companyId,
    });
    if (!submitted.ok) {
      throw new Error(`submitForApproval: ${submitted.error.code}`);
    }
    return { postId, requestId: submitted.data.approvalRequestId };
  }

  async function inviteRecipient(args: {
    requestId: string;
    companyId: string;
    email: string;
  }): Promise<{ rawToken: string; recipientId: string }> {
    const result = await addRecipient({
      approvalRequestId: args.requestId,
      companyId: args.companyId,
      email: args.email,
    });
    if (!result.ok) throw new Error(`addRecipient: ${result.error.code}`);
    return {
      rawToken: result.data.rawToken,
      recipientId: result.data.recipient.id,
    };
  }

  // Tests ----------------------------------------------------------

  describe("resolveRecipientByToken", () => {
    it("returns recipient + request + company on a valid token", async () => {
      const { requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "viewer@external.test",
      });

      const resolved = await resolveRecipientByToken(rawToken);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.data.recipient.email).toBe("viewer@external.test");
      expect(resolved.data.company.name).toBe("Acme Co");
      expect(resolved.data.postState).toBe("pending_client_approval");
    });

    it("returns NOT_FOUND for a malformed token", async () => {
      const resolved = await resolveRecipientByToken("not-a-token");
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND for a well-formed but unknown token", async () => {
      const phantomToken = "0".repeat(64);
      const resolved = await resolveRecipientByToken(phantomToken);
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error.code).toBe("NOT_FOUND");
    });
  });

  describe("recordApprovalDecision — any_one rule", () => {
    it("first approval finalises the request + flips post to approved", async () => {
      const { postId, requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "first@external.test",
      });

      const result = await recordApprovalDecision({
        rawToken,
        decision: "approved",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.finalised).toBe(true);
      expect(result.data.postState).toBe("approved");

      const svc = getServiceRoleClient();
      const post = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", postId)
        .single();
      expect(post.data?.state).toBe("approved");

      const req = await svc
        .from("social_approval_requests")
        .select("final_approved_at, final_approved_by_email")
        .eq("id", requestId)
        .single();
      expect(req.data?.final_approved_at).not.toBeNull();
      expect(req.data?.final_approved_by_email).toBe("first@external.test");

      const events = await svc
        .from("social_approval_events")
        .select("event_type")
        .eq("approval_request_id", requestId);
      expect(events.data?.length).toBe(1);
      expect(events.data?.[0]?.event_type).toBe("approved");
    });

    it("rejection short-circuits — post → 'rejected' regardless of rule", async () => {
      const { postId, requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "reject-me@external.test",
      });

      const result = await recordApprovalDecision({
        rawToken,
        decision: "rejected",
        comment: "wrong tone",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.finalised).toBe(true);
      expect(result.data.postState).toBe("rejected");

      const svc = getServiceRoleClient();
      const req = await svc
        .from("social_approval_requests")
        .select("final_rejected_at, final_approved_at")
        .eq("id", requestId)
        .single();
      expect(req.data?.final_rejected_at).not.toBeNull();
      expect(req.data?.final_approved_at).toBeNull();

      const events = await svc
        .from("social_approval_events")
        .select("event_type, comment_text")
        .eq("approval_request_id", requestId);
      expect(events.data?.length).toBe(1);
      expect(events.data?.[0]?.event_type).toBe("rejected");
      expect(events.data?.[0]?.comment_text).toBe("wrong tone");
    });

    it("changes_requested → post state='changes_requested', request rejected", async () => {
      const { postId, requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "tweak@external.test",
      });

      const result = await recordApprovalDecision({
        rawToken,
        decision: "changes_requested",
        comment: "swap the hashtag please",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.postState).toBe("changes_requested");
    });

    it("two parallel approvals → exactly one finalises; the loser sees INVALID_STATE", async () => {
      // Two recipients on an any_one request. Both approve at once.
      // Postgres serialises via the predicate-guarded UPDATE: one
      // commits final_approved_at, the second's outer txn reads the
      // post-commit state (READ COMMITTED default) and the function
      // RAISEs INVALID_STATE. Mirrors the S1-5 parallel-submit test
      // shape: one ok=true, one ok=false with INVALID_STATE.
      const { postId, requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken: tokenA } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "race-a@external.test",
      });
      const { rawToken: tokenB } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "race-b@external.test",
      });

      const [a, b] = await Promise.all([
        recordApprovalDecision({ rawToken: tokenA, decision: "approved" }),
        recordApprovalDecision({ rawToken: tokenB, decision: "approved" }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      if (failures[0]?.ok === false) {
        expect(failures[0].error.code).toBe("INVALID_STATE");
      }

      const svc = getServiceRoleClient();
      const req = await svc
        .from("social_approval_requests")
        .select("final_approved_at, final_approved_by_email")
        .eq("id", requestId)
        .single();
      expect(req.data?.final_approved_at).not.toBeNull();
      expect(["race-a@external.test", "race-b@external.test"]).toContain(
        req.data?.final_approved_by_email,
      );

      // Exactly one event row landed (the winner). The loser raised
      // before its INSERT, so no orphan audit row.
      const events = await svc
        .from("social_approval_events")
        .select("recipient_id, event_type")
        .eq("approval_request_id", requestId);
      expect(events.data?.length).toBe(1);

      const post = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", postId)
        .single();
      expect(post.data?.state).toBe("approved");
    });

    it("idempotent — second decision from same recipient returns INVALID_STATE", async () => {
      const { requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "double@external.test",
      });

      const first = await recordApprovalDecision({
        rawToken,
        decision: "approved",
      });
      expect(first.ok).toBe(true);

      const second = await recordApprovalDecision({
        rawToken,
        decision: "approved",
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      // Could be either "this reviewer already lodged a decision" OR
      // "approval request is finalised" depending on order; both are
      // the same INVALID_STATE envelope.
      expect(second.error.code).toBe("INVALID_STATE");
    });

    it("revoked recipient cannot decide", async () => {
      const { requestId } = await createSubmittedPost({
        companyId: ANY_ONE_COMPANY_ID,
      });
      const { rawToken, recipientId } = await inviteRecipient({
        requestId,
        companyId: ANY_ONE_COMPANY_ID,
        email: "revoked@external.test",
      });
      const svc = getServiceRoleClient();
      await svc
        .from("social_approval_recipients")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", recipientId);

      const result = await recordApprovalDecision({
        rawToken,
        decision: "approved",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });
  });

  describe("recordApprovalDecision — all_must rule", () => {
    it("partial approvals leave the request open until every active recipient approves", async () => {
      const { postId, requestId } = await createSubmittedPost({
        companyId: ALL_MUST_COMPANY_ID,
      });
      const { rawToken: token1 } = await inviteRecipient({
        requestId,
        companyId: ALL_MUST_COMPANY_ID,
        email: "a@beta.test",
      });
      const { rawToken: token2 } = await inviteRecipient({
        requestId,
        companyId: ALL_MUST_COMPANY_ID,
        email: "b@beta.test",
      });

      const first = await recordApprovalDecision({
        rawToken: token1,
        decision: "approved",
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.finalised).toBe(false);
      expect(first.data.postState).toBe("pending_client_approval");

      const second = await recordApprovalDecision({
        rawToken: token2,
        decision: "approved",
      });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.finalised).toBe(true);
      expect(second.data.postState).toBe("approved");

      const svc = getServiceRoleClient();
      const post = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", postId)
        .single();
      expect(post.data?.state).toBe("approved");
    });

    it("revoking a non-deciding recipient lowers the quorum and finalises", async () => {
      const { postId, requestId } = await createSubmittedPost({
        companyId: ALL_MUST_COMPANY_ID,
      });
      const { rawToken: tokenActive } = await inviteRecipient({
        requestId,
        companyId: ALL_MUST_COMPANY_ID,
        email: "active@beta.test",
      });
      const { recipientId: revokedId } = await inviteRecipient({
        requestId,
        companyId: ALL_MUST_COMPANY_ID,
        email: "to-revoke@beta.test",
      });

      // Revoke the second recipient — quorum is now 1.
      const svc = getServiceRoleClient();
      await svc
        .from("social_approval_recipients")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revokedId);

      const result = await recordApprovalDecision({
        rawToken: tokenActive,
        decision: "approved",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.finalised).toBe(true);
      expect(result.data.postState).toBe("approved");
    });

    it("any rejection finalises immediately even with other approvals pending", async () => {
      const { postId, requestId } = await createSubmittedPost({
        companyId: ALL_MUST_COMPANY_ID,
      });
      const { rawToken: tokenApprove } = await inviteRecipient({
        requestId,
        companyId: ALL_MUST_COMPANY_ID,
        email: "yes@beta.test",
      });
      const { rawToken: tokenReject } = await inviteRecipient({
        requestId,
        companyId: ALL_MUST_COMPANY_ID,
        email: "no@beta.test",
      });

      const yes = await recordApprovalDecision({
        rawToken: tokenApprove,
        decision: "approved",
      });
      expect(yes.ok).toBe(true);
      if (!yes.ok) return;
      expect(yes.data.finalised).toBe(false);

      const no = await recordApprovalDecision({
        rawToken: tokenReject,
        decision: "rejected",
        comment: "blocking on legal",
      });
      expect(no.ok).toBe(true);
      if (!no.ok) return;
      expect(no.data.finalised).toBe(true);
      expect(no.data.postState).toBe("rejected");
    });
  });

  it("decision is rejected once the parent request is already finalised", async () => {
    const { requestId } = await createSubmittedPost({
      companyId: ANY_ONE_COMPANY_ID,
    });
    const { rawToken: tokenA } = await inviteRecipient({
      requestId,
      companyId: ANY_ONE_COMPANY_ID,
      email: "first-finals@external.test",
    });
    const { rawToken: tokenB } = await inviteRecipient({
      requestId,
      companyId: ANY_ONE_COMPANY_ID,
      email: "too-late@external.test",
    });

    const first = await recordApprovalDecision({
      rawToken: tokenA,
      decision: "approved",
    });
    expect(first.ok).toBe(true);

    const late = await recordApprovalDecision({
      rawToken: tokenB,
      decision: "rejected",
    });
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.error.code).toBe("INVALID_STATE");
  });
});
