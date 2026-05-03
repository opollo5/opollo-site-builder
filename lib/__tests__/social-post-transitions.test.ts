import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  approvePost,
  cancelApprovalRequest,
  createPostMaster,
  rejectPost,
  reopenForEditing,
  requestChanges,
  submitForApproval,
} from "@/lib/platform/social/posts";
import { upsertVariant } from "@/lib/platform/social/variants";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-5: lib-layer tests for submitForApproval.
//
// Exercises migration 0071's submit_post_for_approval Postgres function
// end-to-end against the live Supabase stack. Concurrency invariant
// covered explicitly: two parallel submits → exactly one
// social_approval_requests row.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-eeeeeeeeeeee";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-ffffffffffff";

describe("lib/platform/social/posts/submitForApproval", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-5-creator@opollo.test",
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
          slug: "s1-5-acme",
          domain: "s1-5-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-5-beta",
          domain: "s1-5-beta.test",
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

  async function createDraft(text = "ready to submit") {
    const created = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: text,
      createdBy: creator.id,
    });
    if (!created.ok) {
      throw new Error(`createDraft: ${created.error.code}`);
    }
    return created.data;
  }

  it("happy path — flips state to pending_client_approval AND inserts approval_request", async () => {
    const post = await createDraft("hello reviewers");

    const result = await submitForApproval({
      postId: post.id,
      companyId: COMPANY_A_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.approvalRequestId).toMatch(/^[0-9a-f-]{36}$/);

    const svc = getServiceRoleClient();
    const after = await svc
      .from("social_post_master")
      .select("state")
      .eq("id", post.id)
      .single();
    expect(after.error).toBeNull();
    expect(after.data?.state).toBe("pending_client_approval");

    const requests = await svc
      .from("social_approval_requests")
      .select("id, post_master_id, company_id, approval_rule, snapshot_payload, expires_at")
      .eq("post_master_id", post.id);
    expect(requests.error).toBeNull();
    expect(requests.data?.length).toBe(1);
    const req = requests.data?.[0];
    expect(req?.approval_rule).toBe("any_one");
    expect(req?.company_id).toBe(COMPANY_A_ID);
    expect(req?.snapshot_payload).toMatchObject({
      master_text: "hello reviewers",
      link_url: null,
    });
  });

  it("snapshot freezes per-platform variants at submit time", async () => {
    const post = await createDraft("master");
    await upsertVariant({
      postMasterId: post.id,
      companyId: COMPANY_A_ID,
      platform: "linkedin_personal",
      variantText: "linked-in flavour",
    });
    await upsertVariant({
      postMasterId: post.id,
      companyId: COMPANY_A_ID,
      platform: "x",
      variantText: "x flavour",
    });

    const result = await submitForApproval({
      postId: post.id,
      companyId: COMPANY_A_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const svc = getServiceRoleClient();
    const reqRow = await svc
      .from("social_approval_requests")
      .select("snapshot_payload")
      .eq("post_master_id", post.id)
      .single();
    expect(reqRow.error).toBeNull();
    const snap = reqRow.data?.snapshot_payload as {
      variants: Array<{ platform: string; variant_text: string | null; is_custom: boolean }>;
    };
    const li = snap.variants.find((v) => v.platform === "linkedin_personal");
    const x = snap.variants.find((v) => v.platform === "x");
    const fb = snap.variants.find((v) => v.platform === "facebook_page");
    expect(li).toMatchObject({ variant_text: "linked-in flavour", is_custom: true });
    expect(x).toMatchObject({ variant_text: "x flavour", is_custom: true });
    expect(fb).toMatchObject({ variant_text: null, is_custom: false });
  });

  it("two concurrent submits produce exactly one approval_request (atomic)", async () => {
    const post = await createDraft("race target");

    const [a, b] = await Promise.all([
      submitForApproval({ postId: post.id, companyId: COMPANY_A_ID }),
      submitForApproval({ postId: post.id, companyId: COMPANY_A_ID }),
    ]);

    // One must succeed, one must lose.
    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0]?.ok).toBe(false);
    if (!failures[0]?.ok) {
      expect(failures[0]?.error.code).toBe("INVALID_STATE");
    }

    const svc = getServiceRoleClient();
    const requests = await svc
      .from("social_approval_requests")
      .select("id")
      .eq("post_master_id", post.id);
    expect(requests.error).toBeNull();
    expect(requests.data?.length).toBe(1);
  });

  it("rejects submit on non-draft post with INVALID_STATE", async () => {
    const post = await createDraft();
    const svc = getServiceRoleClient();
    await svc
      .from("social_post_master")
      .update({ state: "approved" })
      .eq("id", post.id);

    const result = await submitForApproval({
      postId: post.id,
      companyId: COMPANY_A_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_STATE");
  });

  it("returns NOT_FOUND for cross-company access", async () => {
    const post = await createDraft();
    const result = await submitForApproval({
      postId: post.id,
      companyId: COMPANY_B_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for missing post id", async () => {
    const result = await submitForApproval({
      postId: "00000000-0000-0000-0000-000000000fff",
      companyId: COMPANY_A_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("rejects submit when post has neither master_text nor link_url", async () => {
    const svc = getServiceRoleClient();
    // Insert a post directly with both null (validates the lib-side
    // guard on the submit path; createPostMaster wouldn't allow this).
    const inserted = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_A_ID,
        state: "draft",
        source_type: "manual",
        master_text: null,
        link_url: null,
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const result = await submitForApproval({
      postId: inserted.data!.id as string,
      companyId: COMPANY_A_ID,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("uses approval_default_rule from the company", async () => {
    // Create a post in company B (default rule = all_must per beforeEach
    // setup). Insert directly because creator isn't a member of B.
    const svc = getServiceRoleClient();
    const inserted = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_B_ID,
        state: "draft",
        source_type: "manual",
        master_text: "post in beta",
      })
      .select("id")
      .single();
    expect(inserted.error).toBeNull();

    const result = await submitForApproval({
      postId: inserted.data!.id as string,
      companyId: COMPANY_B_ID,
    });
    expect(result.ok).toBe(true);

    const reqRow = await svc
      .from("social_approval_requests")
      .select("approval_rule")
      .eq("post_master_id", inserted.data!.id)
      .single();
    expect(reqRow.error).toBeNull();
    expect(reqRow.data?.approval_rule).toBe("all_must");
  });

  describe("reopenForEditing", () => {
    async function makeChangesRequestedPost() {
      const post = await createDraft("changes_requested target");
      const svc = getServiceRoleClient();
      // Force the post into changes_requested directly. The realistic
      // path is submit + decision('changes_requested') but we don't
      // need to exercise the full chain just to test reopenForEditing.
      const update = await svc
        .from("social_post_master")
        .update({ state: "changes_requested" })
        .eq("id", post.id)
        .select("id, state")
        .single();
      expect(update.error).toBeNull();
      expect(update.data?.state).toBe("changes_requested");
      return post;
    }

    it("happy path — flips changes_requested → draft", async () => {
      const post = await makeChangesRequestedPost();
      const result = await reopenForEditing({
        postId: post.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.postState).toBe("draft");

      const svc = getServiceRoleClient();
      const after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(after.data?.state).toBe("draft");
    });

    it("rejects reopen on a draft post with INVALID_STATE", async () => {
      const post = await createDraft("already draft");
      const result = await reopenForEditing({
        postId: post.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("rejects reopen on an approved post with INVALID_STATE", async () => {
      const post = await createDraft("approved one");
      const svc = getServiceRoleClient();
      await svc
        .from("social_post_master")
        .update({ state: "approved" })
        .eq("id", post.id);

      const result = await reopenForEditing({
        postId: post.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const post = await makeChangesRequestedPost();
      const result = await reopenForEditing({
        postId: post.id,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND for missing post id", async () => {
      const result = await reopenForEditing({
        postId: "00000000-0000-0000-0000-000000000fff",
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("two parallel reopens converge — only one transitions, the other sees INVALID_STATE", async () => {
      const post = await makeChangesRequestedPost();

      const [a, b] = await Promise.all([
        reopenForEditing({ postId: post.id, companyId: COMPANY_A_ID }),
        reopenForEditing({ postId: post.id, companyId: COMPANY_A_ID }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      if (failures[0]?.ok === false) {
        expect(failures[0].error.code).toBe("INVALID_STATE");
      }

      const svc = getServiceRoleClient();
      const post_after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(post_after.data?.state).toBe("draft");
    });
  });

  describe("cancelApprovalRequest", () => {
    async function createPendingApprovalPost() {
      const post = await createDraft("cancel target");
      const submitted = await submitForApproval({
        postId: post.id,
        companyId: COMPANY_A_ID,
      });
      if (!submitted.ok) {
        throw new Error(`createPendingApprovalPost: ${submitted.error.code}`);
      }
      return { post, requestId: submitted.data.approvalRequestId };
    }

    it("happy path — flips post to draft, revokes the open request, writes a 'revoked' event", async () => {
      const { post, requestId } = await createPendingApprovalPost();

      const result = await cancelApprovalRequest({
        postId: post.id,
        companyId: COMPANY_A_ID,
        actorUserId: creator.id,
        reason: "we need to rework the copy",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.postState).toBe("draft");
      expect(result.data.revoked).toBe(true);
      expect(result.data.eventId).not.toBeNull();

      const svc = getServiceRoleClient();
      const after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(after.data?.state).toBe("draft");

      const req = await svc
        .from("social_approval_requests")
        .select("revoked_at, final_approved_at, final_rejected_at")
        .eq("id", requestId)
        .single();
      expect(req.data?.revoked_at).not.toBeNull();
      expect(req.data?.final_approved_at).toBeNull();
      expect(req.data?.final_rejected_at).toBeNull();

      const events = await svc
        .from("social_approval_events")
        .select("event_type, comment_text, actor_user_id, recipient_id")
        .eq("approval_request_id", requestId);
      expect(events.data?.length).toBe(1);
      const ev = events.data?.[0];
      expect(ev?.event_type).toBe("revoked");
      expect(ev?.comment_text).toBe("we need to rework the copy");
      expect(ev?.actor_user_id).toBe(creator.id);
      expect(ev?.recipient_id).toBeNull();
    });

    it("empty / whitespace reason becomes null in the audit", async () => {
      const { post, requestId } = await createPendingApprovalPost();
      const result = await cancelApprovalRequest({
        postId: post.id,
        companyId: COMPANY_A_ID,
        actorUserId: creator.id,
        reason: "   ",
      });
      expect(result.ok).toBe(true);

      const svc = getServiceRoleClient();
      const ev = await svc
        .from("social_approval_events")
        .select("comment_text")
        .eq("approval_request_id", requestId)
        .single();
      expect(ev.data?.comment_text).toBeNull();
    });

    it("rejects cancel on a draft post with INVALID_STATE", async () => {
      const post = await createDraft("not yet pending");
      const result = await cancelApprovalRequest({
        postId: post.id,
        companyId: COMPANY_A_ID,
        actorUserId: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("rejects cancel on an approved post with INVALID_STATE", async () => {
      const post = await createDraft("already approved");
      const svc = getServiceRoleClient();
      await svc
        .from("social_post_master")
        .update({ state: "approved" })
        .eq("id", post.id);

      const result = await cancelApprovalRequest({
        postId: post.id,
        companyId: COMPANY_A_ID,
        actorUserId: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const { post } = await createPendingApprovalPost();
      const result = await cancelApprovalRequest({
        postId: post.id,
        companyId: COMPANY_B_ID,
        actorUserId: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("two parallel cancels — only one transitions, the other sees INVALID_STATE", async () => {
      const { post, requestId } = await createPendingApprovalPost();

      const [a, b] = await Promise.all([
        cancelApprovalRequest({
          postId: post.id,
          companyId: COMPANY_A_ID,
          actorUserId: creator.id,
        }),
        cancelApprovalRequest({
          postId: post.id,
          companyId: COMPANY_A_ID,
          actorUserId: creator.id,
        }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      if (failures[0]?.ok === false) {
        expect(failures[0].error.code).toBe("INVALID_STATE");
      }

      // Exactly one revoke event landed.
      const svc = getServiceRoleClient();
      const events = await svc
        .from("social_approval_events")
        .select("id")
        .eq("approval_request_id", requestId)
        .eq("event_type", "revoked");
      expect(events.data?.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // S1-48 — approvePost / rejectPost / requestChanges (platform-user approver
  // actions). All three share the same predicate-guarded UPDATE shape, so the
  // test structure mirrors reopenForEditing above.
  // ---------------------------------------------------------------------------

  async function createPendingApprovalPost2(label: string) {
    const post = await createDraft(label);
    const submitted = await submitForApproval({
      postId: post.id,
      companyId: COMPANY_A_ID,
    });
    if (!submitted.ok) {
      throw new Error(`createPendingApprovalPost2: ${submitted.error.code}`);
    }
    return { post, requestId: submitted.data.approvalRequestId };
  }

  describe("approvePost", () => {
    it("happy path — flips pending_client_approval → approved", async () => {
      const { post } = await createPendingApprovalPost2("approve me");
      const result = await approvePost({ postId: post.id, companyId: COMPANY_A_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.postState).toBe("approved");
      expect(result.data.createdBy).toBe(creator.id);

      const svc = getServiceRoleClient();
      const after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(after.data?.state).toBe("approved");
    });

    it("rejects approve on a draft post with INVALID_STATE", async () => {
      const post = await createDraft("draft not pending");
      const result = await approvePost({ postId: post.id, companyId: COMPANY_A_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const { post } = await createPendingApprovalPost2("cross-company approve");
      const result = await approvePost({ postId: post.id, companyId: COMPANY_B_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND for missing post id", async () => {
      const result = await approvePost({
        postId: "00000000-0000-0000-0000-000000000fff",
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("two parallel approves — only one transitions, the other sees INVALID_STATE", async () => {
      const { post } = await createPendingApprovalPost2("race approve");

      const [a, b] = await Promise.all([
        approvePost({ postId: post.id, companyId: COMPANY_A_ID }),
        approvePost({ postId: post.id, companyId: COMPANY_A_ID }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      if (failures[0]?.ok === false) {
        expect(failures[0].error.code).toBe("INVALID_STATE");
      }

      const svc = getServiceRoleClient();
      const after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(after.data?.state).toBe("approved");
    });
  });

  describe("rejectPost", () => {
    it("happy path — flips pending_client_approval → rejected", async () => {
      const { post } = await createPendingApprovalPost2("reject me");
      const result = await rejectPost({ postId: post.id, companyId: COMPANY_A_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.postState).toBe("rejected");
      expect(result.data.createdBy).toBe(creator.id);

      const svc = getServiceRoleClient();
      const after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(after.data?.state).toBe("rejected");
    });

    it("rejects reject on a draft post with INVALID_STATE", async () => {
      const post = await createDraft("draft not pending");
      const result = await rejectPost({ postId: post.id, companyId: COMPANY_A_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const { post } = await createPendingApprovalPost2("cross-company reject");
      const result = await rejectPost({ postId: post.id, companyId: COMPANY_B_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("two parallel rejects — only one transitions", async () => {
      const { post } = await createPendingApprovalPost2("race reject");

      const [a, b] = await Promise.all([
        rejectPost({ postId: post.id, companyId: COMPANY_A_ID }),
        rejectPost({ postId: post.id, companyId: COMPANY_A_ID }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      if (failures[0]?.ok === false) {
        expect(failures[0].error.code).toBe("INVALID_STATE");
      }
    });
  });

  describe("requestChanges", () => {
    it("happy path — flips pending_client_approval → changes_requested", async () => {
      const { post } = await createPendingApprovalPost2("request changes");
      const result = await requestChanges({ postId: post.id, companyId: COMPANY_A_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.postState).toBe("changes_requested");
      expect(result.data.createdBy).toBe(creator.id);

      const svc = getServiceRoleClient();
      const after = await svc
        .from("social_post_master")
        .select("state")
        .eq("id", post.id)
        .single();
      expect(after.data?.state).toBe("changes_requested");
    });

    it("rejects requestChanges on a draft post with INVALID_STATE", async () => {
      const post = await createDraft("draft not pending");
      const result = await requestChanges({ postId: post.id, companyId: COMPANY_A_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const { post } = await createPendingApprovalPost2("cross-company changes");
      const result = await requestChanges({ postId: post.id, companyId: COMPANY_B_ID });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("two parallel requestChanges — only one transitions", async () => {
      const { post } = await createPendingApprovalPost2("race request-changes");

      const [a, b] = await Promise.all([
        requestChanges({ postId: post.id, companyId: COMPANY_A_ID }),
        requestChanges({ postId: post.id, companyId: COMPANY_A_ID }),
      ]);

      const successes = [a, b].filter((r) => r.ok);
      const failures = [a, b].filter((r) => !r.ok);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
      if (failures[0]?.ok === false) {
        expect(failures[0].error.code).toBe("INVALID_STATE");
      }
    });
  });
});
