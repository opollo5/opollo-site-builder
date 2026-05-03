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
  listApprovalEvents,
  recordApprovalDecision,
} from "@/lib/platform/social/approvals";
import {
  createPostMaster,
  submitForApproval,
} from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-8: lib-layer tests for listApprovalEvents (audit trail).
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-555555555555";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-666666666666";

describe("lib/platform/social/approvals/events/list", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-8-creator@opollo.test",
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
          slug: "s1-8-acme",
          domain: "s1-8-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-8-beta",
          domain: "s1-8-beta.test",
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

  it("returns the recorded decision event in chronological order", async () => {
    const post = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "audit me",
      createdBy: creator.id,
    });
    expect(post.ok).toBe(true);
    if (!post.ok) return;

    const submitted = await submitForApproval({
      postId: post.data.id,
      companyId: COMPANY_A_ID,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const recipient = await addRecipient({
      approvalRequestId: submitted.data.approvalRequestId,
      companyId: COMPANY_A_ID,
      email: "auditor@external.test",
      name: "Audit Person",
    });
    expect(recipient.ok).toBe(true);
    if (!recipient.ok) return;

    const decision = await recordApprovalDecision({
      rawToken: recipient.data.rawToken,
      decision: "approved",
      comment: "looks good",
    });
    expect(decision.ok).toBe(true);

    const events = await listApprovalEvents({
      approvalRequestId: submitted.data.approvalRequestId,
      companyId: COMPANY_A_ID,
    });
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(events.data.events.length).toBe(1);
    const ev = events.data.events[0]!;
    expect(ev.event_type).toBe("approved");
    expect(ev.bound_identity_email).toBe("auditor@external.test");
    expect(ev.bound_identity_name).toBe("Audit Person");
    expect(ev.comment_text).toBe("looks good");
  });

  it("returns NOT_FOUND for cross-company access", async () => {
    const post = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "scoped",
      createdBy: creator.id,
    });
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    const submitted = await submitForApproval({
      postId: post.data.id,
      companyId: COMPANY_A_ID,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const events = await listApprovalEvents({
      approvalRequestId: submitted.data.approvalRequestId,
      companyId: COMPANY_B_ID,
    });
    expect(events.ok).toBe(false);
    if (events.ok) return;
    expect(events.error.code).toBe("NOT_FOUND");
  });

  it("returns an empty list for a request with no events yet", async () => {
    const post = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "no events",
      createdBy: creator.id,
    });
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    const submitted = await submitForApproval({
      postId: post.data.id,
      companyId: COMPANY_A_ID,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const events = await listApprovalEvents({
      approvalRequestId: submitted.data.approvalRequestId,
      companyId: COMPANY_A_ID,
    });
    expect(events.ok).toBe(true);
    if (!events.ok) return;
    expect(events.data.events).toEqual([]);
  });
});
