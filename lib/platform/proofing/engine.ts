import "server-only";

import { logger } from "@/lib/logger";
import { addRecipient } from "@/lib/platform/social/approvals/recipients/add";
import { enqueueApprovalCallbacks } from "@/lib/platform/workflow/approval-callbacks";
import {
  getNextStep,
  getPriorStep,
  getWorkflowSteps,
  isBlockingRole,
  type StepRole,
  type WorkflowStep,
  type WorkflowStepParticipant,
} from "@/lib/platform/workflow/steps";
import { sendEmail } from "@/lib/email/sendgrid";
import { renderSocialApprovalRequestEmail } from "@/lib/email/templates/social-approval-request";
import { getServiceRoleClient } from "@/lib/supabase";

import type { ProofSnapshot } from "./types";

// ---------------------------------------------------------------------------
// B3 Multi-step proof engine.
//
// createStepProof — opens a proof using workflow_steps config. Handles
//   version re-entry: revised drafts re-enter at the step that requested
//   changes and skip prior-approved participants (B0 §4).
// advanceToNextStep — called when a step passes; opens the next step OR
//   schedules if this is the final step (B2 drift: intercept onProofPass).
// sendBackStep — gatekeeper (B0 §5) sends back ONE step.
// onStepProofPass — replaces onProofPass when step_id is set; routes to
//   advanceToNextStep or final schedule.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// createStepProof
// ---------------------------------------------------------------------------
export async function createStepProof(input: {
  draftId: string;
  companyId: string;
  submitterUserId: string;
  origin: string;
}): Promise<{ approvalRequestId: string; stepName: string; recipientCount: number } | null> {
  const svc = getServiceRoleClient();

  // 1. Fetch draft
  const { data: draft, error: draftErr } = await svc
    .from("social_post_drafts")
    .select("id, company_id, content_group_id, version_number, content, media_urls, platform_variants, proof_state, supersedes_id")
    .eq("id", input.draftId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (draftErr || !draft) {
    logger.error("proofing.engine.create_step_proof.draft_not_found", { draftId: input.draftId });
    return null;
  }

  const d = draft as {
    id: string;
    company_id: string;
    content_group_id: string;
    version_number: number;
    content: string | null;
    media_urls: string[] | null;
    platform_variants: unknown;
    proof_state: string;
    supersedes_id: string | null;
  };

  // 2. Get ordered workflow steps
  const steps = await getWorkflowSteps(input.companyId);
  if (steps.length === 0) return null;

  // 3. Determine start step + skipped participants (version re-entry, B0 §4)
  let startStep = steps[0];
  let skippedEmails = new Set<string>();

  if (d.supersedes_id) {
    // This is a revision — find re-entry step and skip prior approvers
    const reentryResult = await findReentryStep(
      d.content_group_id,
      steps,
      svc,
    );
    if (reentryResult) {
      startStep = reentryResult.step;
      skippedEmails = reentryResult.skippedEmails;
    }
  }

  // 4. Create snapshot + approval request for the start step
  const snapshot: ProofSnapshot = {
    content_group_id: d.content_group_id,
    draft_id: d.id,
    version_number: d.version_number,
    content: d.content,
    media_urls: d.media_urls,
    platform_variants: d.platform_variants as ProofSnapshot["platform_variants"],
    submitted_at: new Date().toISOString(),
  };

  const expiresAt = new Date(
    Date.now() + startStep.timeout_days * 86_400_000,
  ).toISOString();

  const { data: requestRow, error: requestErr } = await svc
    .from("social_approval_requests")
    .insert({
      company_id: input.companyId,
      post_master_id: null,
      subject_type: "content_proof",
      subject_id: d.content_group_id,
      step_id: startStep.id,
      approval_rule: startStep.pass_rule,
      snapshot_payload: snapshot,
      expires_at: expiresAt,
      created_by: input.submitterUserId,
      updated_by: input.submitterUserId,
    })
    .select("id")
    .single();

  if (requestErr || !requestRow) {
    logger.error("proofing.engine.create_step_proof.request_failed", {
      err: requestErr?.message,
    });
    return null;
  }

  const approvalRequestId = (requestRow as { id: string }).id;

  // 5. Invite step participants (minus skipped ones)
  const invited = await inviteStepParticipants({
    approvalRequestId,
    step: startStep,
    companyId: input.companyId,
    skippedEmails,
    expiresAt,
    snapshot,
    origin: input.origin,
    svc,
  });

  // 6. Advance proof_state → 'in_review'
  await svc
    .from("social_post_drafts")
    .update({ proof_state: "in_review", updated_at: new Date().toISOString() })
    .eq("id", input.draftId);

  // 7. Enqueue reminder ladder
  try {
    const rawOrigin = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000";
    const origin = rawOrigin.startsWith("http") ? rawOrigin : `https://${rawOrigin}`;
    await enqueueApprovalCallbacks({
      approvalRequestId,
      timeoutDays: startStep.timeout_days,
      origin,
    });
  } catch (err) {
    logger.error("proofing.engine.create_step_proof.callbacks_failed", { err: String(err) });
  }

  logger.info("proofing.engine.create_step_proof.created", {
    approvalRequestId,
    draftId: input.draftId,
    stepName: startStep.name,
    stepOrder: startStep.step_order,
    recipientCount: invited,
    isRevision: !!d.supersedes_id,
  });

  return { approvalRequestId, stepName: startStep.name, recipientCount: invited };
}

// ---------------------------------------------------------------------------
// advanceToNextStep
//
// Called after a step passes. If a next step exists → open it.
// If this is the final step → schedule the draft (onProofPassFinal).
// ---------------------------------------------------------------------------
export async function advanceToNextStep(input: {
  approvalRequestId: string;
  companyId: string;
  contentGroupId: string;
  origin: string;
}): Promise<{ advanced: boolean; nextStepName: string | null; scheduled: boolean }> {
  const svc = getServiceRoleClient();

  // Get current step info
  const { data: currentReq } = await svc
    .from("social_approval_requests")
    .select("step_id")
    .eq("id", input.approvalRequestId)
    .maybeSingle();

  const currentStepId = (currentReq as { step_id: string | null } | null)?.step_id;
  if (!currentStepId) {
    // No step_id — this is a simple (non-workflow) proof; schedule directly
    await scheduleApprovedDraft(input.contentGroupId, input.companyId, svc);
    return { advanced: false, nextStepName: null, scheduled: true };
  }

  const currentStep = await getStepById_svc(currentStepId, svc);
  if (!currentStep) {
    await scheduleApprovedDraft(input.contentGroupId, input.companyId, svc);
    return { advanced: false, nextStepName: null, scheduled: true };
  }

  const nextStep = await getNextStep(input.companyId, currentStep.step_order);

  if (!nextStep) {
    // Final step — schedule
    await scheduleApprovedDraft(input.contentGroupId, input.companyId, svc);
    logger.info("proofing.engine.advance.final_step_scheduled", {
      approvalRequestId: input.approvalRequestId,
      contentGroupId: input.contentGroupId,
    });
    return { advanced: false, nextStepName: null, scheduled: true };
  }

  // Get the snapshot from the current request to carry forward
  const { data: currentReqFull } = await svc
    .from("social_approval_requests")
    .select("snapshot_payload, created_by")
    .eq("id", input.approvalRequestId)
    .maybeSingle();

  const snapshot = (currentReqFull as { snapshot_payload: unknown; created_by: string | null } | null)
    ?.snapshot_payload as ProofSnapshot | null;
  const submitterUserId = (currentReqFull as { created_by: string | null } | null)?.created_by ?? "";

  const expiresAt = new Date(Date.now() + nextStep.timeout_days * 86_400_000).toISOString();

  const { data: nextReq, error: nextReqErr } = await svc
    .from("social_approval_requests")
    .insert({
      company_id: input.companyId,
      post_master_id: null,
      subject_type: "content_proof",
      subject_id: input.contentGroupId,
      step_id: nextStep.id,
      approval_rule: nextStep.pass_rule,
      snapshot_payload: snapshot ?? {},
      expires_at: expiresAt,
      created_by: submitterUserId,
      updated_by: submitterUserId,
    })
    .select("id")
    .single();

  if (nextReqErr || !nextReq) {
    logger.error("proofing.engine.advance.next_req_failed", { err: nextReqErr?.message });
    return { advanced: false, nextStepName: null, scheduled: false };
  }

  const nextApprovalRequestId = (nextReq as { id: string }).id;

  await inviteStepParticipants({
    approvalRequestId: nextApprovalRequestId,
    step: nextStep,
    companyId: input.companyId,
    skippedEmails: new Set(),
    expiresAt,
    snapshot: snapshot ?? null,
    origin: input.origin,
    svc,
  });

  // Enqueue reminders for next step
  try {
    const rawOrigin = process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000";
    const origin = rawOrigin.startsWith("http") ? rawOrigin : `https://${rawOrigin}`;
    await enqueueApprovalCallbacks({
      approvalRequestId: nextApprovalRequestId,
      timeoutDays: nextStep.timeout_days,
      origin,
    });
  } catch (err) {
    logger.error("proofing.engine.advance.callbacks_failed", { err: String(err) });
  }

  logger.info("proofing.engine.advance.advanced", {
    from: input.approvalRequestId,
    to: nextApprovalRequestId,
    nextStepName: nextStep.name,
    nextStepOrder: nextStep.step_order,
  });

  return { advanced: true, nextStepName: nextStep.name, scheduled: false };
}

// ---------------------------------------------------------------------------
// sendBackStep — gatekeeper sends back ONE step (B0 §5)
// ---------------------------------------------------------------------------
export async function sendBackStep(input: {
  approvalRequestId: string;
  recipientId: string;       // the gatekeeper's recipient row
  companyId: string;
  contentGroupId: string;
  comment?: string | null;
  origin: string;
}): Promise<{ ok: boolean; priorStepName?: string }> {
  const svc = getServiceRoleClient();

  // 1. Verify the recipient is a gatekeeper in this step
  const { data: req } = await svc
    .from("social_approval_requests")
    .select("step_id, snapshot_payload, created_by")
    .eq("id", input.approvalRequestId)
    .maybeSingle();

  const stepId = (req as { step_id: string | null } | null)?.step_id;
  if (!stepId) {
    return { ok: false };
  }

  const { data: recipient } = await svc
    .from("social_approval_recipients")
    .select("id, email, platform_user_id")
    .eq("id", input.recipientId)
    .eq("approval_request_id", input.approvalRequestId)
    .maybeSingle();

  if (!recipient) {
    return { ok: false };
  }

  const rec = recipient as { id: string; email: string; platform_user_id: string | null };

  // Check gatekeeper role in step participants
  const { data: participant } = await svc
    .from("workflow_step_participants")
    .select("role")
    .eq("step_id", stepId)
    .or(
      rec.platform_user_id
        ? `platform_user_id.eq.${rec.platform_user_id},external_email.eq.${rec.email}`
        : `external_email.eq.${rec.email}`,
    )
    .maybeSingle();

  const participantRole = (participant as { role: string } | null)?.role;
  if (participantRole !== "gatekeeper") {
    logger.warn("proofing.engine.send_back.not_gatekeeper", {
      recipientId: input.recipientId,
      role: participantRole,
    });
    return { ok: false };
  }

  // 2. Find prior step
  const currentStep = await getStepById_svc(stepId, svc);
  if (!currentStep) return { ok: false };

  const priorStep = await getPriorStep(input.companyId, currentStep.step_order);
  if (!priorStep) {
    logger.warn("proofing.engine.send_back.no_prior_step", {
      stepOrder: currentStep.step_order,
    });
    return { ok: false };
  }

  // 3. Revoke current step's approval request
  await svc
    .from("social_approval_requests")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", input.approvalRequestId);

  // 4. Record sent_back event
  await svc.from("social_approval_events").insert({
    approval_request_id: input.approvalRequestId,
    recipient_id: input.recipientId,
    event_type: "sent_back",
    comment_text: input.comment ?? null,
    bound_identity_email: rec.email,
    occurred_at: new Date().toISOString(),
  });

  // 5. Open the prior step
  const snapshot = (req as { snapshot_payload: unknown } | null)?.snapshot_payload as ProofSnapshot | null;
  const submitterUserId = (req as { created_by: string | null } | null)?.created_by ?? "";
  const expiresAt = new Date(Date.now() + priorStep.timeout_days * 86_400_000).toISOString();

  const { data: priorReq, error: priorReqErr } = await svc
    .from("social_approval_requests")
    .insert({
      company_id: input.companyId,
      post_master_id: null,
      subject_type: "content_proof",
      subject_id: input.contentGroupId,
      step_id: priorStep.id,
      approval_rule: priorStep.pass_rule,
      snapshot_payload: snapshot ?? {},
      expires_at: expiresAt,
      created_by: submitterUserId,
      updated_by: submitterUserId,
    })
    .select("id")
    .single();

  if (priorReqErr || !priorReq) {
    logger.error("proofing.engine.send_back.prior_req_failed", { err: priorReqErr?.message });
    return { ok: false };
  }

  await inviteStepParticipants({
    approvalRequestId: (priorReq as { id: string }).id,
    step: priorStep,
    companyId: input.companyId,
    skippedEmails: new Set(),
    expiresAt,
    snapshot,
    origin: input.origin,
    svc,
  });

  logger.info("proofing.engine.send_back.completed", {
    from: input.approvalRequestId,
    priorStepName: priorStep.name,
    gatekeeperEmail: rec.email,
  });

  return { ok: true, priorStepName: priorStep.name };
}

// ---------------------------------------------------------------------------
// onStepProofPass — intercepts onProofPass for workflow-step proofs.
// If the passing request has a step_id, routes to advance or schedule.
// ---------------------------------------------------------------------------
export async function onStepProofPass(input: {
  approvalRequestId: string;
  contentGroupId: string;
  companyId: string;
  origin: string;
}): Promise<{ wasIntercepted: boolean }> {
  const svc = getServiceRoleClient();

  const { data: req } = await svc
    .from("social_approval_requests")
    .select("step_id")
    .eq("id", input.approvalRequestId)
    .maybeSingle();

  const stepId = (req as { step_id: string | null } | null)?.step_id;
  if (!stepId) {
    // No step_id — not a workflow-step proof; caller handles scheduling
    return { wasIntercepted: false };
  }

  await advanceToNextStep({
    approvalRequestId: input.approvalRequestId,
    companyId: input.companyId,
    contentGroupId: input.contentGroupId,
    origin: input.origin,
  });

  return { wasIntercepted: true };
}

// ---------------------------------------------------------------------------
// getProofDashboard — Pending + Stuck views (B3 scope: two views, no SLA)
// ---------------------------------------------------------------------------
export type DashboardItem = {
  approvalRequestId: string;
  contentGroupId: string;
  companyId: string;
  stepName: string | null;
  stepOrder: number | null;
  snapshot: ProofSnapshot | null;
  pendingRecipients: Array<{ email: string; name: string | null }>;
  openedAt: string;
  expiresAt: string;
  isStuck: boolean;
};

export async function getProofDashboard(
  companyId: string,
): Promise<{ pending: DashboardItem[]; stuck: DashboardItem[] }> {
  const svc = getServiceRoleClient();

  // Open (non-finalised) content_proof requests for this company
  const { data: openRequests } = await svc
    .from("social_approval_requests")
    .select(
      "id, subject_id, company_id, step_id, snapshot_payload, expires_at, created_at",
    )
    .eq("company_id", companyId)
    .eq("subject_type", "content_proof")
    .is("final_approved_at", null)
    .is("final_rejected_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (!openRequests || openRequests.length === 0) {
    return { pending: [], stuck: [] };
  }

  const requestIds = (openRequests as Array<{ id: string }>).map((r) => r.id);
  const stepIds = (openRequests as Array<{ step_id: string | null }>)
    .map((r) => r.step_id)
    .filter(Boolean) as string[];

  // Load step names
  const stepMap: Record<string, { name: string; step_order: number }> = {};
  if (stepIds.length > 0) {
    const { data: steps } = await svc
      .from("workflow_steps")
      .select("id, name, step_order")
      .in("id", stepIds);
    for (const s of (steps ?? []) as Array<{ id: string; name: string; step_order: number }>) {
      stepMap[s.id] = { name: s.name, step_order: s.step_order };
    }
  }

  // Find recipients who haven't yet decided
  const { data: allRecipients } = await svc
    .from("social_approval_recipients")
    .select("id, approval_request_id, email, name, revoked_at")
    .in("approval_request_id", requestIds)
    .is("revoked_at", null);

  const { data: decidedEvents } = await svc
    .from("social_approval_events")
    .select("recipient_id, event_type")
    .in("approval_request_id", requestIds)
    .in("event_type", ["approved", "rejected", "changes_requested"]);

  const decidedRecipientIds = new Set(
    (decidedEvents ?? []).map((e) => (e as { recipient_id: string }).recipient_id),
  );

  type RecipientRow = { id: string; approval_request_id: string; email: string; name: string | null };
  const pendingByRequest: Record<string, Array<{ email: string; name: string | null }>> = {};
  for (const r of (allRecipients ?? []) as RecipientRow[]) {
    if (!decidedRecipientIds.has(r.id)) {
      (pendingByRequest[r.approval_request_id] ??= []).push({
        email: r.email,
        name: r.name,
      });
    }
  }

  const now = Date.now();
  const pending: DashboardItem[] = [];
  const stuck: DashboardItem[] = [];

  for (const r of openRequests as Array<{
    id: string; subject_id: string; company_id: string;
    step_id: string | null; snapshot_payload: unknown;
    expires_at: string; created_at: string;
  }>) {
    const stepInfo = r.step_id ? stepMap[r.step_id] : null;
    const item: DashboardItem = {
      approvalRequestId: r.id,
      contentGroupId: r.subject_id,
      companyId: r.company_id,
      stepName: stepInfo?.name ?? null,
      stepOrder: stepInfo?.step_order ?? null,
      snapshot: (r.snapshot_payload as ProofSnapshot | null) ?? null,
      pendingRecipients: pendingByRequest[r.id] ?? [],
      openedAt: r.created_at,
      expiresAt: r.expires_at,
      isStuck: new Date(r.expires_at).getTime() < now,
    };

    if (item.isStuck) {
      stuck.push(item);
    } else {
      pending.push(item);
    }
  }

  return { pending, stuck };
}

// ---------------------------------------------------------------------------
// getVersionComparison — returns the version chain for side-by-side display
// ---------------------------------------------------------------------------
export type VersionSnapshot = {
  draftId: string;
  versionNumber: number;
  proofState: string;
  content: string | null;
  mediaUrls: string[] | null;
  archivedAt: string | null;
  approvedAt: string | null;
};

export async function getVersionComparison(
  contentGroupId: string,
): Promise<VersionSnapshot[]> {
  const svc = getServiceRoleClient();

  const { data: drafts } = await svc
    .from("social_post_drafts")
    .select(
      "id, version_number, proof_state, content, media_urls, archived_at",
    )
    .eq("content_group_id", contentGroupId)
    .order("version_number", { ascending: false });

  if (!drafts) return [];

  // Find approval timestamps from finalised requests
  const draftIds = (drafts as Array<{ id: string }>).map((d) => d.id);
  const { data: approved } = await svc
    .from("social_approval_requests")
    .select("snapshot_payload, final_approved_at")
    .eq("subject_type", "content_proof")
    .eq("subject_id", contentGroupId)
    .not("final_approved_at", "is", null);

  const approvedByDraft: Record<string, string> = {};
  for (const a of (approved ?? []) as Array<{ snapshot_payload: unknown; final_approved_at: string }>) {
    const snap = a.snapshot_payload as { draft_id?: string } | null;
    if (snap?.draft_id) {
      approvedByDraft[snap.draft_id] = a.final_approved_at;
    }
  }

  return (drafts as Array<{
    id: string; version_number: number; proof_state: string;
    content: string | null; media_urls: string[] | null; archived_at: string | null;
  }>).map((d) => ({
    draftId: d.id,
    versionNumber: d.version_number,
    proofState: d.proof_state,
    content: d.content,
    mediaUrls: d.media_urls,
    archivedAt: d.archived_at,
    approvedAt: approvedByDraft[d.id] ?? null,
  }));
}

// ---------------------------------------------------------------------------
// getAuditTrail — flat event log for CSV export
// ---------------------------------------------------------------------------
export type AuditEvent = {
  occurred_at: string;
  event_type: string;
  actor_email: string | null;
  actor_name: string | null;
  step_name: string | null;
  step_order: number | null;
  comment: string | null;
  version_number: number | null;
  decision: string | null;
};

export async function getAuditTrail(
  contentGroupId: string,
): Promise<AuditEvent[]> {
  const svc = getServiceRoleClient();

  const { data: requests } = await svc
    .from("social_approval_requests")
    .select("id, step_id, snapshot_payload, created_at, final_approved_at, final_rejected_at")
    .eq("subject_type", "content_proof")
    .eq("subject_id", contentGroupId)
    .order("created_at", { ascending: true });

  if (!requests || requests.length === 0) return [];

  const requestIds = (requests as Array<{ id: string }>).map((r) => r.id);
  const stepIds = (requests as Array<{ step_id: string | null }>)
    .map((r) => r.step_id).filter(Boolean) as string[];

  const stepMap: Record<string, { name: string; step_order: number }> = {};
  if (stepIds.length > 0) {
    const { data: steps } = await svc
      .from("workflow_steps")
      .select("id, name, step_order")
      .in("id", stepIds);
    for (const s of (steps ?? []) as Array<{ id: string; name: string; step_order: number }>) {
      stepMap[s.id] = s;
    }
  }

  const { data: events } = await svc
    .from("social_approval_events")
    .select(
      "approval_request_id, event_type, comment_text, bound_identity_email, bound_identity_name, occurred_at",
    )
    .in("approval_request_id", requestIds)
    .order("occurred_at", { ascending: true });

  type RequestRow = {
    id: string; step_id: string | null; snapshot_payload: unknown;
    created_at: string; final_approved_at: string | null; final_rejected_at: string | null;
  };
  const requestMap = Object.fromEntries(
    (requests as RequestRow[]).map((r) => [r.id, r]),
  );

  const trail: AuditEvent[] = [];

  for (const e of (events ?? []) as Array<{
    approval_request_id: string;
    event_type: string;
    comment_text: string | null;
    bound_identity_email: string | null;
    bound_identity_name: string | null;
    occurred_at: string;
  }>) {
    const req = requestMap[e.approval_request_id];
    const stepInfo = req?.step_id ? stepMap[req.step_id] : null;
    const snap = req?.snapshot_payload as { version_number?: number } | null;

    trail.push({
      occurred_at: e.occurred_at,
      event_type: e.event_type,
      actor_email: e.bound_identity_email,
      actor_name: e.bound_identity_name,
      step_name: stepInfo?.name ?? null,
      step_order: stepInfo?.step_order ?? null,
      comment: e.comment_text,
      version_number: snap?.version_number ?? null,
      decision: ["approved", "rejected", "changes_requested", "sent_back"].includes(e.event_type)
        ? e.event_type
        : null,
    });
  }

  return trail;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getStepById_svc(
  stepId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<WorkflowStep | null> {
  const { data } = await svc
    .from("workflow_steps")
    .select("id, company_id, step_order, name, pass_rule, blocking, timeout_days")
    .eq("id", stepId)
    .maybeSingle();
  if (!data) return null;

  const { data: participants } = await svc
    .from("workflow_step_participants")
    .select("id, step_id, platform_user_id, external_email, role")
    .eq("step_id", stepId);

  return {
    ...(data as WorkflowStep),
    participants: (participants ?? []) as WorkflowStepParticipant[],
  };
}

async function scheduleApprovedDraft(
  contentGroupId: string,
  companyId: string,
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<void> {
  const now = new Date().toISOString();

  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("id, state, scheduled_at, proof_state")
    .eq("content_group_id", contentGroupId)
    .eq("company_id", companyId)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!draft) return;

  const d = draft as { id: string; state: string; scheduled_at: string | null; proof_state: string };
  const scheduledAt =
    d.scheduled_at && new Date(d.scheduled_at).getTime() > Date.now()
      ? d.scheduled_at
      : now;

  await svc
    .from("social_post_drafts")
    .update({
      proof_state: "approved",
      state: "scheduled",
      scheduled_at: scheduledAt,
      updated_at: now,
    })
    .eq("id", d.id);
}

async function inviteStepParticipants(input: {
  approvalRequestId: string;
  step: WorkflowStep;
  companyId: string;
  skippedEmails: Set<string>;
  expiresAt: string;
  snapshot: ProofSnapshot | null;
  origin: string;
  svc: ReturnType<typeof getServiceRoleClient>;
}): Promise<number> {
  let count = 0;

  for (const p of input.step.participants) {
    const email = p.email ?? p.external_email ?? "";
    if (!email || input.skippedEmails.has(email.toLowerCase())) continue;

    const addResult = await addRecipient({
      approvalRequestId: input.approvalRequestId,
      companyId: input.companyId,
      email,
      name: p.name ?? null,
      requiresOtp: false,
      isBlocking: isBlockingRole(p.role as WorkflowStepParticipant["role"]),
    });

    if (!addResult.ok) {
      logger.warn("proofing.engine.invite.recipient_failed", {
        approvalRequestId: input.approvalRequestId,
        email,
        err: addResult.error.message,
      });
      continue;
    }

    // Day-0 invite email
    const reviewUrl = `${input.origin}/approve/${addResult.data.rawToken}`;
    try {
      const { data: company } = await input.svc
        .from("platform_companies")
        .select("name")
        .eq("id", input.companyId)
        .maybeSingle();

      const companyName = (company as { name: string } | null)?.name ?? "Opollo";
      const versionLabel = input.snapshot?.version_number
        ? `v${input.snapshot.version_number}`
        : undefined;

      const { subject, html, text } = renderSocialApprovalRequestEmail({
        recipient_email: email,
        recipient_name: p.name ?? null,
        company_name: companyName,
        review_url: reviewUrl,
        expires_at: input.expiresAt,
        versionLabel,
        reviewerRole: formatRole(p.role as StepRole),
      });

      await sendEmail({ to: email, subject, html, text });
    } catch (emailErr) {
      logger.error("proofing.engine.invite.email_failed", {
        email,
        err: String(emailErr),
      });
    }

    count++;
  }

  return count;
}

async function findReentryStep(
  contentGroupId: string,
  steps: WorkflowStep[],
  svc: ReturnType<typeof getServiceRoleClient>,
): Promise<{ step: WorkflowStep; skippedEmails: Set<string> } | null> {
  // Find the most recent changes_requested approval request for this content group
  const { data: priorRequest } = await svc
    .from("social_approval_requests")
    .select("id, step_id, final_rejected_at")
    .eq("subject_type", "content_proof")
    .eq("subject_id", contentGroupId)
    .not("final_rejected_at", "is", null)
    .order("final_rejected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!priorRequest) return null;

  const stepId = (priorRequest as { step_id: string | null }).step_id;
  const reentryStep = stepId ? steps.find((s) => s.id === stepId) : steps[0];
  if (!reentryStep) return null;

  // Find participants who approved steps BEFORE the re-entry step
  const priorStepIds = steps
    .filter((s) => s.step_order < reentryStep.step_order)
    .map((s) => s.id);

  const skippedEmails = new Set<string>();
  if (priorStepIds.length > 0) {
    // Find approval requests for prior steps in this content group
    const { data: priorRequests } = await svc
      .from("social_approval_requests")
      .select("id")
      .eq("subject_type", "content_proof")
      .eq("subject_id", contentGroupId)
      .in("step_id", priorStepIds)
      .not("final_approved_at", "is", null);

    if (priorRequests && priorRequests.length > 0) {
      const priorReqIds = (priorRequests as Array<{ id: string }>).map((r) => r.id);
      const { data: approvedEvents } = await svc
        .from("social_approval_events")
        .select("bound_identity_email")
        .in("approval_request_id", priorReqIds)
        .eq("event_type", "approved");

      for (const e of (approvedEvents ?? []) as Array<{ bound_identity_email: string | null }>) {
        if (e.bound_identity_email) {
          skippedEmails.add(e.bound_identity_email.toLowerCase());
        }
      }
    }
  }

  return { step: reentryStep, skippedEmails };
}

function formatRole(role: StepRole): string {
  switch (role) {
    case "reviewer": return "Reviewer";
    case "mandatory_reviewer": return "Required reviewer";
    case "gatekeeper": return "Gatekeeper";
    case "approver": return "Approver";
  }
}
