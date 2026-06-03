import "server-only";

import { logger } from "@/lib/logger";
import { issue, regenerateApprovalLink } from "@/lib/platform/magic-link";
import { addRecipient } from "@/lib/platform/social/approvals/recipients/add";
import { resolveRecipientByToken } from "@/lib/platform/social/approvals";
import { enqueueApprovalCallbacks } from "@/lib/platform/workflow/approval-callbacks";
import { onStepProofPass } from "@/lib/platform/proofing/engine";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderSocialApprovalRequestEmail } from "@/lib/email/templates/social-approval-request";
import { getServiceRoleClient } from "@/lib/supabase";

import type {
  CreateProofInput,
  CreateProofResult,
  OnProofPassInput,
  OnProofRejectInput,
  ProofQueueItem,
  ProofSnapshot,
  ReviseProofInput,
  ReviseProofResult,
} from "./types";

// ---------------------------------------------------------------------------
// createProof
//
// Opens a social_approval_request (subject_type='content_proof') for a V2
// draft, invites recipients via B1 magic links, sends day-0 invite emails
// (drift #2 fix — createBatchApprovalRequest never sent these), and
// advances proof_state → 'in_review'.
// ---------------------------------------------------------------------------
export async function createProof(
  input: CreateProofInput,
): Promise<CreateProofResult> {
  const svc = getServiceRoleClient();
  const expiryDays = input.expiryDays ?? 14;

  // 1. Fetch the draft and verify company + content_group_id.
  const { data: draft, error: draftErr } = await svc
    .from("social_post_drafts")
    .select("id, company_id, content_group_id, version_number, content, media_urls, platform_variants, proof_state, state")
    .eq("id", input.draftId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (draftErr || !draft) {
    throw new Error(`Draft not found: ${input.draftId}`);
  }

  const d = draft as {
    id: string;
    company_id: string;
    content_group_id: string;
    version_number: number;
    content: string | null;
    media_urls: string[] | null;
    platform_variants: Record<string, unknown> | null;
    proof_state: string;
    state: string;
  };

  if (d.proof_state !== "draft" && d.proof_state !== "in_revision") {
    throw new Error(
      `Draft proof_state '${d.proof_state}' cannot be submitted for review. Must be 'draft' or 'in_revision'.`,
    );
  }

  // 2. Snapshot: immutable record of content at proof-creation time.
  const snapshot: ProofSnapshot = {
    content_group_id: d.content_group_id,
    draft_id: d.id,
    version_number: d.version_number,
    content: d.content,
    media_urls: d.media_urls,
    platform_variants: d.platform_variants as ProofSnapshot["platform_variants"],
    submitted_at: new Date().toISOString(),
  };

  const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();

  // 3. Create the approval request.
  const { data: requestRow, error: requestErr } = await svc
    .from("social_approval_requests")
    .insert({
      company_id: input.companyId,
      post_master_id: null,          // V2 proof — no V1 post master
      subject_type: "content_proof",
      subject_id: d.content_group_id, // group-scoped (stable across versions)
      approval_rule: input.approvalRule,
      snapshot_payload: snapshot,
      expires_at: expiresAt,
      created_by: input.submitterUserId,
      updated_by: input.submitterUserId,
    })
    .select("id")
    .single();

  if (requestErr || !requestRow) {
    throw new Error(
      `Failed to create approval request: ${requestErr?.message ?? "no row returned"}`,
    );
  }

  const approvalRequestId = (requestRow as { id: string }).id;

  // 4. Invite each recipient via B1 addRecipient() + send day-0 invite email.
  // This is the drift #2 fix: day-0 invite email was never sent by
  // createBatchApprovalRequest; we send it here while rawToken is in scope.
  let recipientCount = 0;
  for (const r of input.recipients) {
    const addResult = await addRecipient({
      approvalRequestId,
      companyId: input.companyId,
      email: r.email,
      name: r.name ?? null,
      requiresOtp: r.requiresOtp,
    });

    if (!addResult.ok) {
      logger.warn("proofing.create_proof.recipient_failed", {
        approvalRequestId,
        email: r.email,
        err: addResult.error.message,
      });
      continue;
    }

    // Day-0 invite email — send while rawToken is in scope.
    const reviewUrl = `${input.origin}/approve/${addResult.data.rawToken}`;
    try {
      const { subject, html, text } = renderSocialApprovalRequestEmail({
        recipient_email: r.email,
        recipient_name: r.name ?? null,
        company_name: "", // resolved below
        review_url: reviewUrl,
        expires_at: expiresAt,
        versionLabel: `v${d.version_number}`,
        reviewerRole: "Reviewer",
      });

      // Resolve company name for the email subject.
      const { data: company } = await svc
        .from("platform_companies")
        .select("name")
        .eq("id", input.companyId)
        .maybeSingle();

      const companyName = (company as { name: string } | null)?.name ?? "Your review";
      const { subject: subjectWithName, html: htmlWithName, text: textWithName } =
        renderSocialApprovalRequestEmail({
          recipient_email: r.email,
          recipient_name: r.name ?? null,
          company_name: companyName,
          review_url: reviewUrl,
          expires_at: expiresAt,
          versionLabel: `v${d.version_number}`,
          reviewerRole: "Reviewer",
        });

      await sendEmail({ to: r.email, subject: subjectWithName, html: htmlWithName, text: textWithName });
    } catch (emailErr) {
      logger.error("proofing.create_proof.invite_email_failed", {
        approvalRequestId,
        email: r.email,
        err: String(emailErr),
      });
    }

    recipientCount++;
  }

  // 5. Advance proof_state → 'in_review'.
  await svc
    .from("social_post_drafts")
    .update({ proof_state: "in_review", updated_at: new Date().toISOString() })
    .eq("id", input.draftId);

  // 6. Enqueue day-3/7/14 reminders.
  try {
    const rawOrigin = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000";
    const origin = rawOrigin.startsWith("http") ? rawOrigin : `https://${rawOrigin}`;
    await enqueueApprovalCallbacks({
      approvalRequestId,
      timeoutDays: expiryDays,
      origin,
    });
  } catch (err) {
    logger.error("proofing.create_proof.enqueue_callbacks_failed", {
      approvalRequestId,
      err: String(err),
    });
  }

  logger.info("proofing.create_proof.created", {
    approvalRequestId,
    draftId: input.draftId,
    contentGroupId: d.content_group_id,
    recipientCount,
    companyId: input.companyId,
  });

  return { approvalRequestId, recipientCount };
}

// ---------------------------------------------------------------------------
// reviseProof
//
// Creates a new draft version (v+1) inheriting the same content_group_id.
// Archives the current version (proof_state='in_revision', archived_at=now).
// The new draft starts as proof_state='draft' for the operator to edit.
//
// The new draft MUST have content_group_id set explicitly (no default in
// steady state per Steven's amendment) — we propagate it from the parent.
// ---------------------------------------------------------------------------
export async function reviseProof(
  input: ReviseProofInput,
): Promise<ReviseProofResult> {
  const svc = getServiceRoleClient();

  const { data: draft, error: draftErr } = await svc
    .from("social_post_drafts")
    .select("id, company_id, content_group_id, version_number, content, media_urls, platform_variants, target_profiles, proof_state, created_by")
    .eq("id", input.draftId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (draftErr || !draft) {
    throw new Error(`Draft not found for revise: ${input.draftId}`);
  }

  const d = draft as {
    id: string;
    company_id: string;
    content_group_id: string;
    version_number: number;
    content: string | null;
    media_urls: string[] | null;
    platform_variants: unknown;
    target_profiles: unknown;
    proof_state: string;
    created_by: string | null;
  };

  if (
    d.proof_state !== "changes_requested" &&
    d.proof_state !== "in_review"
  ) {
    throw new Error(
      `Cannot revise draft with proof_state '${d.proof_state}'. Must be 'changes_requested' or 'in_review'.`,
    );
  }

  const newVersionNumber = d.version_number + 1;
  const now = new Date().toISOString();

  // Create new version. content_group_id MUST be set explicitly (no default).
  const { data: newDraft, error: insertErr } = await svc
    .from("social_post_drafts")
    .insert({
      company_id: d.company_id,
      created_by: input.revisedByUserId,
      updated_by: input.revisedByUserId,
      content_group_id: d.content_group_id, // explicit: same group
      version_number: newVersionNumber,      // explicit: next version
      supersedes_id: d.id,
      content: d.content,
      media_urls: d.media_urls,
      platform_variants: d.platform_variants,
      target_profiles: d.target_profiles,
      state: "draft",
      proof_state: "draft",
      draft_version: 1,
      draft_data: {}, // NOT NULL column — empty object is the valid "no draft data" value
    })
    .select("id")
    .single();

  if (insertErr || !newDraft) {
    throw new Error(`Failed to create revised draft: ${insertErr?.message}`);
  }

  const newDraftId = (newDraft as { id: string }).id;

  // Archive the old version.
  await svc
    .from("social_post_drafts")
    .update({ proof_state: "in_revision", archived_at: now, updated_at: now })
    .eq("id", input.draftId);

  logger.info("proofing.revise_proof.created", {
    oldDraftId: input.draftId,
    newDraftId,
    contentGroupId: d.content_group_id,
    newVersionNumber,
    companyId: input.companyId,
  });

  return {
    newDraftId,
    contentGroupId: d.content_group_id,
    versionNumber: newVersionNumber,
  };
}

// ---------------------------------------------------------------------------
// onProofPass
//
// Called when a content_proof approval request is finalised as 'approved'.
// Advances proof_state → 'approved', then hands the draft to the V2 publish
// path by setting state='scheduled'. The publish-due cron handles the rest.
// ---------------------------------------------------------------------------
export async function onProofPass(input: OnProofPassInput & { origin?: string }): Promise<void> {
  // B3 intercept: if this approval request belongs to a workflow step,
  // delegate to the step engine (advance or final-schedule).
  // Only fires for content_proof requests with a step_id.
  const { wasIntercepted } = await onStepProofPass({
    approvalRequestId: input.approvalRequestId,
    contentGroupId: input.contentGroupId,
    companyId: input.companyId,
    origin: input.origin ?? (process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000"),
  });

  // Step engine handled it (either advanced or scheduled).
  if (wasIntercepted) return;

  // No step_id — simple B2 proof, schedule directly.
  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  // Find the current (non-archived) draft for this content group.
  const { data: draft, error: draftErr } = await svc
    .from("social_post_drafts")
    .select("id, state, scheduled_at, proof_state")
    .eq("content_group_id", input.contentGroupId)
    .eq("company_id", input.companyId)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftErr || !draft) {
    logger.error("proofing.on_proof_pass.draft_not_found", {
      contentGroupId: input.contentGroupId,
      companyId: input.companyId,
      err: draftErr?.message,
    });
    return;
  }

  const d = draft as { id: string; state: string; scheduled_at: string | null; proof_state: string };

  // L16 edge cases: determine scheduled_at for the publish handoff.
  // null → set to now(); past → set to now(); present/future → keep as-is.
  const existingScheduledAt = d.scheduled_at;
  const scheduledAt =
    existingScheduledAt && new Date(existingScheduledAt).getTime() > Date.now()
      ? existingScheduledAt
      : now;

  const { error: updateErr } = await svc
    .from("social_post_drafts")
    .update({
      proof_state: "approved",
      state: "scheduled",
      scheduled_at: scheduledAt,
      updated_at: now,
    })
    .eq("id", d.id);

  if (updateErr) {
    logger.error("proofing.on_proof_pass.update_failed", {
      draftId: d.id,
      err: updateErr.message,
    });
    return;
  }

  logger.info("proofing.on_proof_pass.approved_and_scheduled", {
    draftId: d.id,
    contentGroupId: input.contentGroupId,
    scheduledAt,
    approvalRequestId: input.approvalRequestId,
  });
}

// ---------------------------------------------------------------------------
// onProofReject
//
// Called when a content_proof is rejected or changes_requested.
// Advances proof_state → 'changes_requested'. The operator then calls
// reviseProof() to create a new version.
// ---------------------------------------------------------------------------
export async function onProofReject(input: OnProofRejectInput): Promise<void> {
  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  const { data: draft, error: draftErr } = await svc
    .from("social_post_drafts")
    .select("id, proof_state")
    .eq("content_group_id", input.contentGroupId)
    .eq("company_id", input.companyId)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftErr || !draft) {
    logger.error("proofing.on_proof_reject.draft_not_found", {
      contentGroupId: input.contentGroupId,
      err: draftErr?.message,
    });
    return;
  }

  const d = draft as { id: string; proof_state: string };

  const { error: updateErr } = await svc
    .from("social_post_drafts")
    .update({ proof_state: "changes_requested", updated_at: now })
    .eq("id", d.id);

  if (updateErr) {
    logger.error("proofing.on_proof_reject.update_failed", {
      draftId: d.id,
      err: updateErr.message,
    });
    return;
  }

  logger.info("proofing.on_proof_reject.changes_requested", {
    draftId: d.id,
    contentGroupId: input.contentGroupId,
    approvalRequestId: input.approvalRequestId,
    hasComment: !!input.comment,
  });
}

// ---------------------------------------------------------------------------
// getProofQueue
//
// Returns all open proofs awaiting a decision from the reviewer identified
// by rawToken. Uses resolveRecipientByToken (which consumes the session).
//
// For reviews other than the one the token directly maps to, the reviewer
// must request a fresh magic link (via /proof/request or the resend path).
// ---------------------------------------------------------------------------
export async function getProofQueue(rawToken: string): Promise<{
  items: ProofQueueItem[];
  reviewerEmail: string | null;
}> {
  // Resolve and consume the token (establishes session).
  const resolved = await resolveRecipientByToken(rawToken);
  if (!resolved.ok) {
    return { items: [], reviewerEmail: null };
  }

  const { recipient, request } = resolved.data;
  const reviewerEmail = recipient.email;
  const svc = getServiceRoleClient();

  // Find all open approval requests for this reviewer's email (content_proof only).
  const { data: openRecipients, error } = await svc
    .from("social_approval_recipients")
    .select(
      "id, approval_request_id, email",
    )
    .eq("email", reviewerEmail)
    .is("revoked_at", null);

  if (error || !openRecipients) {
    return { items: [], reviewerEmail };
  }

  const items: ProofQueueItem[] = [];
  const seenRequests = new Set<string>();

  for (const r of openRecipients as Array<{ id: string; approval_request_id: string; email: string }>) {
    if (seenRequests.has(r.approval_request_id)) continue;
    seenRequests.add(r.approval_request_id);

    // Load the approval request — only content_proof type, not finalised.
    const { data: req } = await svc
      .from("social_approval_requests")
      .select("id, subject_type, subject_id, company_id, expires_at, snapshot_payload, final_approved_at, final_rejected_at, revoked_at")
      .eq("id", r.approval_request_id)
      .maybeSingle();

    if (!req) continue;
    const reqRow = req as {
      id: string;
      subject_type: string | null;
      subject_id: string | null;
      company_id: string;
      expires_at: string;
      snapshot_payload: unknown;
      final_approved_at: string | null;
      final_rejected_at: string | null;
      revoked_at: string | null;
    };

    // Only content_proof, not finalised.
    if (reqRow.subject_type !== "content_proof") continue;
    if (reqRow.final_approved_at || reqRow.final_rejected_at || reqRow.revoked_at) continue;

    // Check if reviewer already decided on this request.
    const { data: decision } = await svc
      .from("social_approval_events")
      .select("id")
      .eq("approval_request_id", r.approval_request_id)
      .eq("recipient_id", r.id)
      .in("event_type", ["approved", "rejected", "changes_requested"])
      .maybeSingle();

    if (decision) continue; // already decided

    const { data: company } = await svc
      .from("platform_companies")
      .select("name")
      .eq("id", reqRow.company_id)
      .maybeSingle();

    const snapshot = reqRow.snapshot_payload as ProofSnapshot | null;
    const versionNumber = snapshot?.version_number ?? 1;

    items.push({
      approvalRequestId: reqRow.id,
      recipientId: r.id,
      contentGroupId: reqRow.subject_id ?? "",
      snapshot,
      companyName: (company as { name: string } | null)?.name ?? "Opollo",
      expiresAt: reqRow.expires_at,
      versionLabel: `v${versionNumber}`,
      // This is the item the current token directly maps to.
      isCurrentToken: r.approval_request_id === request.id,
    });
  }

  return { items, reviewerEmail };
}
