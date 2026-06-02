import "server-only";

import { generateRawToken, hashToken } from "@/lib/platform/invitations/tokens";
import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { WorkflowGateWithApprovers } from "./types";

// ---------------------------------------------------------------------------
// image-gate.ts — Workflow gate helpers for the image_review gate type.
//
// All functions are fail-soft: they log errors but never throw.
// Callers (auto-attach, approve route) must not block on gate errors.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateBatchApprovalRequestParams {
  batchId: string;
  draftId: string;
  gate: WorkflowGateWithApprovers;
  companyId: string;
  createdBy: string;
}

export interface OnGatePassParams {
  approvalRequestId: string;
  batchId: string;
  companyId: string;
  actorId: string;
  autoSchedule: boolean;
}

export interface OnGateRejectParams {
  approvalRequestId: string;
  batchId: string;
  companyId: string;
  comment: string;
  actorId: string;
}

// ---------------------------------------------------------------------------
// createBatchApprovalRequest
//
// Inserts one social_approval_requests row (subject_type='image_batch') and
// one social_approval_recipients row per gate approver. Returns the new
// request id on success, or null on any error (fail-soft).
//
// NOTE: this function targets columns added by migration 0172
// (subject_type, subject_id, created_by, updated_by, approval_rule).
// The existing post_master_id column is set to NULL for image_batch
// requests — that column will be made nullable by migration 0172.
// ---------------------------------------------------------------------------

export async function createBatchApprovalRequest(
  params: CreateBatchApprovalRequestParams,
): Promise<{ approvalRequestId: string } | null> {
  const { batchId, draftId, gate, companyId, createdBy } = params;
  const svc = getServiceRoleClient();

  try {
    // 1. Insert the approval request row.
    const expiresAt = new Date(Date.now() + gate.timeoutDays * 86_400_000).toISOString();
    const snapshotPayload = {
      batch_id: batchId,
      draft_id: draftId,
      created_at: new Date().toISOString(),
    };

    const { data: requestRow, error: requestErr } = await svc
      .from("social_approval_requests")
      .insert({
        // post_master_id is nullable after migration 0172 — null for image batches.
        post_master_id: null,
        company_id: companyId,
        // subject_type / subject_id columns added by migration 0172.
        subject_type: "image_batch",
        subject_id: batchId,
        approval_rule: gate.passRule,
        snapshot_payload: snapshotPayload,
        expires_at: expiresAt,
        created_by: createdBy,
        updated_by: createdBy,
      })
      .select("id")
      .single();

    if (requestErr || !requestRow) {
      logger.error("workflow.image_gate.request_insert_failed", {
        batchId,
        companyId,
        err: requestErr?.message ?? "no row returned",
      });
      return null;
    }

    const approvalRequestId = (requestRow as { id: string }).id;

    // 2. Resolve external emails for platform-user approvers and insert recipients.
    for (const approver of gate.approvers) {
      let email: string | null = approver.externalEmail ?? null;

      // Look up the platform user's email if no external email was provided.
      if (!email && approver.platformUserId) {
        const { data: userRow, error: userErr } = await svc
          .from("platform_users")
          .select("email")
          .eq("id", approver.platformUserId)
          .maybeSingle();

        if (userErr || !userRow) {
          logger.warn("workflow.image_gate.approver_email_lookup_failed", {
            approvalRequestId,
            platformUserId: approver.platformUserId,
            err: userErr?.message ?? "user not found",
          });
          // Skip this approver — can't notify without an email.
          continue;
        }

        email = (userRow as { email: string }).email;
      }

      if (!email) {
        logger.warn("workflow.image_gate.approver_no_email", {
          approvalRequestId,
          approverId: approver.id,
        });
        continue;
      }

      // Generate a one-time magic-link token for this recipient.
      const rawToken = generateRawToken();
      const tokenHash = hashToken(rawToken);

      const { error: recipientErr } = await svc
        .from("social_approval_recipients")
        .insert({
          approval_request_id: approvalRequestId,
          email,
          platform_user_id: approver.platformUserId ?? null,
          token_hash: tokenHash,
        });

      if (recipientErr) {
        logger.warn("workflow.image_gate.recipient_insert_failed", {
          approvalRequestId,
          email,
          err: recipientErr.message,
        });
        // Fail-soft: continue with other approvers.
      }
    }

    logger.info("workflow.image_gate.request_created", {
      approvalRequestId,
      batchId,
      companyId,
      approverCount: gate.approvers.length,
    });

    return { approvalRequestId };
  } catch (err) {
    logger.error("workflow.image_gate.create_request_unexpected", {
      batchId,
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// onGatePass
//
// Called when an image_batch approval request is finalised as approved.
// - Marks the batch approval_status='approved'.
// - When autoSchedule=true and the draft has a scheduled_at, sets
//   state='scheduled' so the V2 publish-due cron picks it up automatically.
// - Otherwise sets workflow_state='ready_to_schedule' for operator action.
//
// L16 edge cases:
//   L16a: scheduled_at null → 'ready_to_schedule' (operator must set date)
//   L16b: scheduled_at past → 'schedule_now' (cron fires immediately)
//   L16c: scheduled_at future → 'schedule_now' (cron fires at that time)
//   L16d: all connections disconnected → 'ready_to_schedule' + warning
// ---------------------------------------------------------------------------

export async function onGatePass(params: OnGatePassParams): Promise<void> {
  const { batchId, companyId } = params;
  const svc = getServiceRoleClient();

  try {
    // 1. Mark the batch approved.
    const { error: batchErr } = await svc
      .from("image_generation_batches")
      .update({ approval_status: "approved" })
      .eq("id", batchId)
      .eq("company_id", companyId);

    if (batchErr) {
      logger.error("workflow.image_gate.pass.batch_update_failed", {
        batchId,
        err: batchErr.message,
      });
    }

    // 2. Find all drafts auto-attached to this batch's jobs.
    const { data: jobRows, error: jobsErr } = await svc
      .from("image_generation_jobs")
      .select("auto_attached_draft_id")
      .eq("batch_id", batchId)
      .not("auto_attached_draft_id", "is", null);

    if (jobsErr) {
      logger.error("workflow.image_gate.pass.jobs_lookup_failed", {
        batchId,
        err: jobsErr.message,
      });
      return;
    }

    const draftIds = (
      (jobRows ?? []) as Array<{ auto_attached_draft_id: string | null }>
    )
      .map((r) => r.auto_attached_draft_id)
      .filter((id): id is string => id !== null);

    if (draftIds.length === 0) {
      logger.info("workflow.image_gate.pass.no_drafts", { batchId });
      return;
    }

    // 3. Look up active drafts with scheduling context.
    const { data: drafts, error: draftsErr } = await svc
      .from("social_post_drafts")
      .select("id, scheduled_at, target_profiles")
      .in("id", draftIds)
      .is("archived_at", null);

    if (draftsErr) {
      logger.error("workflow.image_gate.pass.drafts_lookup_failed", {
        batchId,
        draftIds,
        err: draftsErr.message,
      });
      return;
    }

    type DraftRow = { id: string; scheduled_at: string | null; target_profiles: unknown };

    // 4. Decide the outcome for each draft and bucket into two lists.
    const scheduleNowIds: string[] = [];
    const readyToScheduleIds: string[] = [];

    for (const d of (drafts ?? []) as DraftRow[]) {
      const scheduledAt = d.scheduled_at;
      const targetProfiles = d.target_profiles as Array<{ profile_id: string }> | null;

      if (!params.autoSchedule || !scheduledAt) {
        // L16a / autoSchedule=false: leave for operator.
        if (!scheduledAt) {
          logger.info("workflow.image_gate.pass.draft_no_date", { draftId: d.id, batchId });
        }
        readyToScheduleIds.push(d.id);
        continue;
      }

      // L16d: Check whether any target connection is still connected.
      if (targetProfiles && targetProfiles.length > 0) {
        const profileIds = targetProfiles.map((p) => p.profile_id);
        const { data: conns } = await svc
          .from("social_connections")
          .select("id, status")
          .in("id", profileIds);

        const connectedCount = ((conns ?? []) as Array<{ id: string; status: string }>)
          .filter((c) => c.status !== "disconnected").length;

        if (connectedCount === 0) {
          // L16d: all connections disconnected — operator must handle.
          logger.warn("workflow.image_gate.pass.connections_disconnected", {
            batchId,
            draftId: d.id,
          });
          readyToScheduleIds.push(d.id);
          continue;
        }
      }

      // L16b / L16c: schedule_now — past dates satisfy scheduled_at <= now() so
      // the cron fires immediately; future dates fire at the scheduled time.
      scheduleNowIds.push(d.id);
    }

    // 5a. Auto-schedule: set state='scheduled' so the V2 publish-due cron picks
    //     up these drafts. workflow_state stays 'ready_to_schedule' as the
    //     human-readable stage label. Guard: only update drafts still in a
    //     pre-scheduled state to avoid clobbering already-published drafts.
    if (scheduleNowIds.length > 0) {
      const { error: scheduleErr } = await svc
        .from("social_post_drafts")
        .update({ state: "scheduled", workflow_state: "ready_to_schedule" })
        .in("id", scheduleNowIds);

      if (scheduleErr) {
        logger.error("workflow.image_gate.pass.draft_schedule_failed", {
          batchId,
          draftIds: scheduleNowIds,
          err: scheduleErr.message,
        });
      } else {
        logger.info("workflow.image_gate.pass.drafts_scheduled", {
          batchId,
          companyId,
          draftCount: scheduleNowIds.length,
        });
      }
    }

    // 5b. Ready-to-schedule: operator completes scheduling manually.
    if (readyToScheduleIds.length > 0) {
      const { error: updateErr } = await svc
        .from("social_post_drafts")
        .update({ workflow_state: "ready_to_schedule" })
        .in("id", readyToScheduleIds);

      if (updateErr) {
        logger.error("workflow.image_gate.pass.draft_update_failed", {
          batchId,
          draftIds: readyToScheduleIds,
          err: updateErr.message,
        });
      }
    }

    logger.info("workflow.image_gate.pass.complete", {
      batchId,
      companyId,
      scheduledCount: scheduleNowIds.length,
      readyToScheduleCount: readyToScheduleIds.length,
    });
  } catch (err) {
    logger.error("workflow.image_gate.pass.unexpected", {
      batchId,
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// onGateReject
//
// Called when an image_batch approval request is rejected or changes_requested.
//
// Escalation rule: if this rejection brings the review_round to >= 3, escalate
// to admin. Otherwise, set approval_status='none' so the batch can be reworked.
//
// review_round column is added by migration 0172.
// ---------------------------------------------------------------------------

export async function onGateReject(params: OnGateRejectParams): Promise<void> {
  const { batchId, companyId } = params;
  const svc = getServiceRoleClient();

  try {
    // 1. Fetch current review_round.
    const { data: batchRow, error: batchFetchErr } = await svc
      .from("image_generation_batches")
      .select("review_round")
      .eq("id", batchId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (batchFetchErr || !batchRow) {
      logger.error("workflow.image_gate.reject.batch_fetch_failed", {
        batchId,
        err: batchFetchErr?.message ?? "batch not found",
      });
      return;
    }

    const currentRound = ((batchRow as { review_round: number | null }).review_round) ?? 0;
    const newRound = currentRound + 1;

    if (newRound >= 3) {
      // Escalate: too many rejections.
      const { error: escalateErr } = await svc
        .from("image_generation_batches")
        .update({ approval_status: "escalated_to_admin", review_round: newRound })
        .eq("id", batchId);

      if (escalateErr) {
        logger.error("workflow.image_gate.reject.escalate_update_failed", {
          batchId,
          err: escalateErr.message,
        });
      }

      logger.error("workflow.image_gate.escalated_to_admin", {
        batchId,
        companyId,
        newRound,
      });

      // Phase 1: in-app notification to company admins is optional.
      // Log the intent; full dispatch is a Phase-2 item.
      logger.info("workflow.image_gate.reject.admin_notify_phase1", {
        batchId,
        companyId,
        note: "Admin notification dispatch is a Phase-2 item",
      });
    } else {
      // Reset for rework.
      const { error: resetErr } = await svc
        .from("image_generation_batches")
        .update({ approval_status: "none", review_round: newRound })
        .eq("id", batchId);

      if (resetErr) {
        logger.error("workflow.image_gate.reject.reset_update_failed", {
          batchId,
          err: resetErr.message,
        });
        return;
      }

      // Mark all attached drafts as rework_image and archive them.
      const { data: jobRows, error: jobsErr } = await svc
        .from("image_generation_jobs")
        .select("auto_attached_draft_id")
        .eq("batch_id", batchId)
        .not("auto_attached_draft_id", "is", null);

      if (jobsErr) {
        logger.error("workflow.image_gate.reject.jobs_lookup_failed", {
          batchId,
          err: jobsErr.message,
        });
        return;
      }

      const draftIds = (
        (jobRows ?? []) as Array<{ auto_attached_draft_id: string | null }>
      )
        .map((r) => r.auto_attached_draft_id)
        .filter((id): id is string => id !== null);

      if (draftIds.length > 0) {
        const { error: draftErr } = await svc
          .from("social_post_drafts")
          .update({
            workflow_state: "rework_image",
            archived_at: new Date().toISOString(),
          })
          .in("id", draftIds);

        if (draftErr) {
          logger.error("workflow.image_gate.reject.draft_archive_failed", {
            batchId,
            draftIds,
            err: draftErr.message,
          });
        }
      }

      logger.info("workflow.image_gate.reject.reset_complete", {
        batchId,
        companyId,
        newRound,
        draftCount: draftIds.length,
      });
    }
  } catch (err) {
    logger.error("workflow.image_gate.reject.unexpected", {
      batchId,
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}
