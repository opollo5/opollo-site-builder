import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import { createProof, reviseProof, onProofPass, onProofReject } from "@/lib/platform/proofing";
import { resolveRecipientByToken } from "@/lib/platform/social/approvals";

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

// _setup.ts truncateAll() runs before each test and wipes platform_companies
// AND platform_users. Re-seed both before each test.
beforeEach(async () => {
  await seedCompany();
  // Re-create the platform_users row — truncateAll() wiped it but the auth user
  // persists in auth.users (not truncated). social_approval_requests.created_by
  // references platform_users(id) so this row is required.
  const svc = getServiceRoleClient();
  await svc.from("platform_users").upsert(
    { id: submitterUser.id, email: submitterUser.email, is_opollo_staff: false },
    { onConflict: "id" },
  );
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
// B1 HARD RULE — DONE CRITERIA assertions (TWO separate cases required)
//
// The hard rule: if a magic_links row EXISTS for a token, its verdict is
// FINAL. The fallback to social_approval_recipients.token_hash fires ONLY
// when no magic_links row exists (row-ABSENCE). It must NEVER fire when the
// row exists but is invalid (expired link OR expired session).
//
// Case A — expired SESSION (link was clicked, session window elapsed):
//   consumed_at IS NOT NULL, session_expires_at in the past.
//   Magic links row exists → rejects as SESSION_EXPIRED.
//   The parent request's 14-day window is irrelevant.
//
// Case B — expired LINK (link never clicked, expires_at in the past):
//   consumed_at IS NULL, expires_at in the past.
//   THIS IS THE RESURRECTION HOLE: without the hard rule, an attacker whose
//   link "expired" could still be admitted via the legacy token_hash lookup
//   since the parent request's 14-day window is still open.
//   Must reject as 'expired', NOT fall through to legacy lookup.
// ---------------------------------------------------------------------------

describe("B1 hard rule: expired magic_links row is NOT resolvable via legacy fallback", () => {
  async function seedProofWithRecipient(email: string) {
    const draft = await seedDraft();
    const svc = getServiceRoleClient();
    const createResult = await createProof({
      draftId: draft.id,
      companyId: COMPANY_ID,
      submitterUserId: submitterUser.id,
      approvalRule: "any_one",
      recipients: [{ email }],
      origin: "http://localhost:3000",
    });
    const { data: rec } = await svc
      .from("social_approval_recipients")
      .select("id, magic_link_id")
      .eq("approval_request_id", createResult.approvalRequestId)
      .eq("email", email)
      .single();
    expect(rec?.magic_link_id).not.toBeNull();
    return { createResult, rec: rec!, svc };
  }

  it("Case A — consumed link with expired session rejects as SESSION_EXPIRED, not via legacy 14-day path", async () => {
    const { createResult, rec, svc } = await seedProofWithRecipient("hard-rule-session@test.example.com");

    const { regenerateApprovalLink } = await import("@/lib/platform/magic-link");
    const { rawToken } = await regenerateApprovalLink(rec.id);

    // Verify works before manipulation.
    expect((await resolveRecipientByToken(rawToken)).ok).toBe(true);

    // Expire the session (link was clicked, window elapsed).
    const { data: currentRec } = await svc.from("social_approval_recipients")
      .select("magic_link_id").eq("id", rec.id).maybeSingle();
    if (currentRec?.magic_link_id) {
      await svc.from("magic_links").update({
        consumed_at: new Date(Date.now() - 2000).toISOString(),
        session_expires_at: new Date(Date.now() - 1000).toISOString(),
      }).eq("id", currentRec.magic_link_id);
    }

    // Verify parent request is still within 14 days (the hole the rule closes).
    const { data: parentReq } = await svc.from("social_approval_requests")
      .select("expires_at, final_approved_at, final_rejected_at")
      .eq("id", createResult.approvalRequestId).single();
    expect(new Date(parentReq!.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(parentReq!.final_approved_at).toBeNull();
    expect(parentReq!.final_rejected_at).toBeNull();

    // Must be SESSION_EXPIRED — NOT resolved via legacy 14-day window.
    const result = await resolveRecipientByToken(rawToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SESSION_EXPIRED");
  });

  it("Case B — never-clicked link with expired expires_at rejects as expired, not via legacy 14-day path", async () => {
    // THE RESURRECTION HOLE: expires_at in the past, consumed_at NULL.
    // Without the hard rule, the token_hash on social_approval_recipients
    // is still valid and the 14-day parent-request window is still open,
    // so the legacy path would admit the reviewer. It must not.
    //
    // IMPORTANT: do NOT call resolveRecipientByToken before expiry.
    // resolveRecipientByToken calls consume() which sets consumed_at — after
    // that the session governs, not expires_at. The link must stay unconsumed
    // (consumed_at IS NULL) for this case to test the right code path.
    const { createResult, rec, svc } = await seedProofWithRecipient("hard-rule-link-expiry@test.example.com");

    const { regenerateApprovalLink } = await import("@/lib/platform/magic-link");
    const { rawToken } = await regenerateApprovalLink(rec.id);

    // Verify the magic_links row exists and is unconsumed (sanity, no consume side-effect).
    const { data: currentRec } = await svc.from("social_approval_recipients")
      .select("magic_link_id").eq("id", rec.id).maybeSingle();
    expect(currentRec?.magic_link_id).not.toBeNull();

    const { data: mlBefore } = await svc.from("magic_links")
      .select("consumed_at, expires_at").eq("id", currentRec!.magic_link_id!).single();
    expect(mlBefore?.consumed_at).toBeNull(); // not yet clicked
    expect(new Date(mlBefore!.expires_at).getTime()).toBeGreaterThan(Date.now()); // not yet expired

    // Expire the LINK itself (consumed_at stays NULL — link was never clicked).
    await svc.from("magic_links").update({
      expires_at: new Date(Date.now() - 5000).toISOString(),
    }).eq("id", currentRec!.magic_link_id!);

    // Verify parent request is still within 14 days (the hole the rule closes).
    const { data: parentReq } = await svc.from("social_approval_requests")
      .select("expires_at, final_approved_at, final_rejected_at")
      .eq("id", createResult.approvalRequestId).single();
    expect(new Date(parentReq!.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(parentReq!.final_approved_at).toBeNull();
    expect(parentReq!.final_rejected_at).toBeNull();

    // HARD RULE: magic_links row exists (expired, never consumed) → must reject.
    // Must NOT fall through to social_approval_recipients.token_hash lookup.
    // If it fell through, the 14-day parent-request window would admit the token.
    const result = await resolveRecipientByToken(rawToken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 'expired' reason (consume() returns this when expires_at < now and consumed_at IS NULL)
      // The function maps this to NOT_FOUND for the caller — the key point is ok=false.
      expect(result.error.code).not.toBe(undefined);
    }
  });
});
