import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import { createProof, reviseProof, onProofPass, onProofReject } from "@/lib/platform/proofing";
import { resolveRecipientByToken } from "@/lib/platform/social/approvals";
import { addRecipient } from "@/lib/platform/social/approvals/recipients/add";
import { seedAuthUser } from "./_auth-helpers";
import type { SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// Integration tests for Core Proofing V1 (B2).
// Runs against the real local Supabase instance.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001750-0000-0000-0000-000000000001";
// SUBMITTER_USER_ID is set from the seeded auth user in beforeAll.
let submitterUser: SeededAuthUser;

async function seedCompany() {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("platform_companies").upsert(
    { id: COMPANY_ID, name: "Proofing Test Co", slug: `proof-test-${COMPANY_ID.slice(-8)}` },
    { onConflict: "id" },
  );
  if (error) throw new Error(`seedCompany failed: ${error.message}`);
}

async function seedDraft(overrides: Record<string, unknown> = {}) {
  const svc = getServiceRoleClient();
  const { randomUUID } = await import("node:crypto");
  const contentGroupId = randomUUID();
  const { data, error } = await svc
    .from("social_post_drafts")
    .insert({
      company_id: COMPANY_ID,
      created_by: submitterUser.id,
      updated_by: submitterUser.id,
      content: "Test social proof content",
      media_urls: ["https://example.com/test.jpg"],
      state: "draft",
      proof_state: "draft",
      content_group_id: contentGroupId,
      version_number: 1,
      draft_version: 1,
      ...overrides,
    })
    .select("id, content_group_id, version_number, proof_state")
    .single();
  if (error || !data) throw new Error(`seedDraft failed: ${error?.message}`);
  return data as { id: string; content_group_id: string; version_number: number; proof_state: string };
}

beforeAll(async () => {
  // persistent: true — not tracked by cleanupTrackedAuthUsers(), so truncateAll()
  // doesn't delete this user between tests. Cleaned up explicitly in afterAll.
  submitterUser = await seedAuthUser({ role: "user", persistent: true });
});

// _setup.ts truncateAll() runs before each test and wipes platform_companies.
// Re-seed the company before each test.
beforeEach(async () => {
  await seedCompany();
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  if (submitterUser?.id) {
    await svc.auth.admin.deleteUser(submitterUser.id);
  }
});

// ---------------------------------------------------------------------------
// createProof
// ---------------------------------------------------------------------------

describe("createProof", () => {
  it("creates approval request with subject_type=content_proof and sets proof_state=in_review", async () => {
    const draft = await seedDraft();
    const svc = getServiceRoleClient();

    const result = await createProof({
      draftId: draft.id,
      companyId: COMPANY_ID,
      submitterUserId: submitterUser.id,
      approvalRule: "any_one",
      recipients: [{ email: "proof-reviewer@test.example.com", name: "Test Reviewer" }],
      origin: "http://localhost:3000",
    });

    expect(result.approvalRequestId).toBeTruthy();
    expect(result.recipientCount).toBe(1);

    // Verify approval request has correct subject_type
    const { data: req } = await svc
      .from("social_approval_requests")
      .select("subject_type, subject_id")
      .eq("id", result.approvalRequestId)
      .single();

    expect(req?.subject_type).toBe("content_proof");
    expect(req?.subject_id).toBe(draft.content_group_id);

    // Verify draft is now in_review
    const { data: updatedDraft } = await svc
      .from("social_post_drafts")
      .select("proof_state")
      .eq("id", draft.id)
      .single();

    expect(updatedDraft?.proof_state).toBe("in_review");
  });

  it("adds recipient with magic_link_id FK set (B1 dual-write)", async () => {
    const draft = await seedDraft();
    const svc = getServiceRoleClient();

    const result = await createProof({
      draftId: draft.id,
      companyId: COMPANY_ID,
      submitterUserId: submitterUser.id,
      approvalRule: "any_one",
      recipients: [{ email: "proof-reviewer2@test.example.com" }],
      origin: "http://localhost:3000",
    });

    const { data: recipient } = await svc
      .from("social_approval_recipients")
      .select("magic_link_id, token_hash")
      .eq("approval_request_id", result.approvalRequestId)
      .maybeSingle();

    expect(recipient?.magic_link_id).not.toBeNull();
    expect(recipient?.token_hash).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// reviseProof
// ---------------------------------------------------------------------------

describe("reviseProof", () => {
  it("creates v2 with same content_group_id, supersedes_id=v1, v1 archived", async () => {
    const draft = await seedDraft();
    const svc = getServiceRoleClient();

    // Put the draft in changes_requested state first
    await svc.from("social_post_drafts").update({ proof_state: "changes_requested" }).eq("id", draft.id);

    const result = await reviseProof({
      draftId: draft.id,
      companyId: COMPANY_ID,
      revisedByUserId: submitterUser.id,
    });

    expect(result.newDraftId).not.toBe(draft.id);
    expect(result.versionNumber).toBe(2);
    expect(result.contentGroupId).toBe(draft.content_group_id);

    // New draft inherits content_group_id and has supersedes_id pointing to old
    const { data: newDraft } = await svc
      .from("social_post_drafts")
      .select("content_group_id, version_number, supersedes_id, proof_state, state")
      .eq("id", result.newDraftId)
      .single();

    expect(newDraft?.content_group_id).toBe(draft.content_group_id);
    expect(newDraft?.version_number).toBe(2);
    expect(newDraft?.supersedes_id).toBe(draft.id);
    expect(newDraft?.proof_state).toBe("draft");
    expect(newDraft?.state).toBe("draft");

    // Old draft is archived with proof_state=in_revision
    const { data: oldDraft } = await svc
      .from("social_post_drafts")
      .select("proof_state, archived_at")
      .eq("id", draft.id)
      .single();

    expect(oldDraft?.proof_state).toBe("in_revision");
    expect(oldDraft?.archived_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// onProofPass and onProofReject
// ---------------------------------------------------------------------------

describe("onProofPass", () => {
  it("sets proof_state=approved and state=scheduled", async () => {
    const draft = await seedDraft();
    const svc = getServiceRoleClient();
    await svc.from("social_post_drafts").update({ proof_state: "in_review" }).eq("id", draft.id);

    await onProofPass({
      approvalRequestId: "00000000-0000-0000-0000-ffffffffffff",
      contentGroupId: draft.content_group_id,
      companyId: COMPANY_ID,
    });

    const { data: updated } = await svc
      .from("social_post_drafts")
      .select("proof_state, state, scheduled_at")
      .eq("id", draft.id)
      .single();

    expect(updated?.proof_state).toBe("approved");
    expect(updated?.state).toBe("scheduled");
    expect(updated?.scheduled_at).not.toBeNull();
  });

  it("preserves future scheduled_at when already set", async () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const draft = await seedDraft({ proof_state: "in_review", scheduled_at: futureDate });
    const svc = getServiceRoleClient();

    await onProofPass({
      approvalRequestId: "00000000-0000-0000-0000-fffffffffffe",
      contentGroupId: draft.content_group_id,
      companyId: COMPANY_ID,
    });

    const { data: updated } = await svc
      .from("social_post_drafts")
      .select("scheduled_at")
      .eq("id", draft.id)
      .single();

    // Future scheduled_at should be preserved
    expect(new Date(updated?.scheduled_at!).getTime()).toBeCloseTo(
      new Date(futureDate).getTime(),
      -3, // within 1 second
    );
  });
});

describe("onProofReject", () => {
  it("sets proof_state=changes_requested", async () => {
    const draft = await seedDraft();
    const svc = getServiceRoleClient();
    await svc.from("social_post_drafts").update({ proof_state: "in_review" }).eq("id", draft.id);

    await onProofReject({
      approvalRequestId: "00000000-0000-0000-0000-fffffffffffd",
      contentGroupId: draft.content_group_id,
      companyId: COMPANY_ID,
      comment: "Please update the copy",
    });

    const { data: updated } = await svc
      .from("social_post_drafts")
      .select("proof_state")
      .eq("id", draft.id)
      .single();

    expect(updated?.proof_state).toBe("changes_requested");
  });
});

// ---------------------------------------------------------------------------
// B1 HARD RULE — DONE CRITERIA assertion
//
// An expired magic_links row with its social_approval_recipients.token_hash
// still intact and the parent request still inside its 14-day window MUST
// be rejected at /approve/[token]. It must NOT fall through to the legacy
// token_hash lookup. Fallback fires on magic_links row-ABSENCE only.
// ---------------------------------------------------------------------------

describe("B1 hard rule: expired magic_links row is NOT resolvable via legacy fallback", () => {
  it("expired magic_links row → SESSION_EXPIRED, never falls through to legacy 14-day window", async () => {
    // Seed a draft and create a proof to get a real approval recipient
    const draft = await seedDraft();
    const svc = getServiceRoleClient();
    const createResult = await createProof({
      draftId: draft.id,
      companyId: COMPANY_ID,
      submitterUserId: submitterUser.id,
      approvalRule: "any_one",
      recipients: [{ email: "hard-rule-test@test.example.com" }],
      origin: "http://localhost:3000",
    });

    // Get the recipient's magic_link_id
    const { data: rec } = await svc
      .from("social_approval_recipients")
      .select("id, magic_link_id, token_hash")
      .eq("approval_request_id", createResult.approvalRequestId)
      .eq("email", "hard-rule-test@test.example.com")
      .single();

    expect(rec?.magic_link_id).not.toBeNull();

    // Get the raw token indirectly — we can't recover it from the hash,
    // so we use addRecipient to get a fresh one, then expire it.
    const addResult = await addRecipient({
      approvalRequestId: createResult.approvalRequestId,
      companyId: COMPANY_ID,
      email: "hard-rule-expired@test.example.com",
    });
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    // Verify the raw token works before expiry.
    const beforeExpire = await resolveRecipientByToken(addResult.data.rawToken);
    expect(beforeExpire.ok).toBe(true);

    // Now expire the magic_links row for this recipient.
    const { data: expiredRec } = await svc
      .from("social_approval_recipients")
      .select("magic_link_id")
      .eq("email", "hard-rule-expired@test.example.com")
      .eq("approval_request_id", createResult.approvalRequestId)
      .maybeSingle();

    if (expiredRec?.magic_link_id) {
      await svc
        .from("magic_links")
        .update({
          consumed_at: new Date(Date.now() - 2000).toISOString(),
          session_expires_at: new Date(Date.now() - 1000).toISOString(),
        })
        .eq("id", expiredRec.magic_link_id);
    }

    // Verify the parent request is still inside its 14-day window
    const { data: parentReq } = await svc
      .from("social_approval_requests")
      .select("expires_at, final_approved_at, final_rejected_at")
      .eq("id", createResult.approvalRequestId)
      .single();

    expect(new Date(parentReq!.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(parentReq!.final_approved_at).toBeNull();
    expect(parentReq!.final_rejected_at).toBeNull();

    // THE HARD RULE: must be SESSION_EXPIRED, NOT resolved via legacy fallback.
    const afterExpire = await resolveRecipientByToken(addResult.data.rawToken);
    expect(afterExpire.ok).toBe(false);
    if (!afterExpire.ok) {
      // Must be a session error — NOT a successful resolution via the 14-day window.
      expect(afterExpire.error.code).toBe("SESSION_EXPIRED");
    }
  });
});
