import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Batch-level operations: delete and reset-to-fresh.
//
// Both functions are fail-soft: each step is wrapped in try/catch so a
// failure in one step (e.g. draft archival) doesn't abort the remaining
// cleanup steps.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// deleteBatch
//
// Permanently removes a batch and all associated data in a defined order:
//   a. Identify jobs + draft IDs
//   b. Soft-delete attached social_post_drafts (archive)
//   c. Find open approval requests for the batch
//   d. Revoke approval recipients
//   e. Mark approval requests revoked
//   f. Hard-delete image_selections for the batch jobs
//   g. Hard-delete image_generation_jobs
//   h. Hard-delete image_generation_batches
// ---------------------------------------------------------------------------
export async function deleteBatch(
  batchId: string,
  companyId: string,
  actorId: string,
): Promise<void> {
  const svc = getServiceRoleClient();

  // ── a. Find all jobs ─────────────────────────────────────────────────────
  let jobIds: string[] = [];
  let draftIds: string[] = [];

  try {
    const { data: jobs, error } = await svc
      .from("image_generation_jobs")
      .select("id, auto_attached_draft_id")
      .eq("batch_id", batchId)
      .eq("company_id", companyId);

    if (error) {
      logger.error("batch_ops.delete.jobs_lookup_failed", {
        batchId,
        err: error.message,
      });
    } else {
      const rows = (jobs ?? []) as Array<{
        id: string;
        auto_attached_draft_id: string | null;
      }>;
      jobIds = rows.map((r) => r.id);
      draftIds = rows
        .map((r) => r.auto_attached_draft_id)
        .filter((id): id is string => id !== null);
    }
  } catch (err) {
    logger.error("batch_ops.delete.jobs_lookup_threw", {
      batchId,
      err: String(err),
    });
  }

  logger.info("batch_ops.delete.jobs_found", {
    batchId,
    jobCount: jobIds.length,
    draftCount: draftIds.length,
  });

  // ── b. Soft-delete attached drafts ───────────────────────────────────────
  if (draftIds.length > 0) {
    try {
      const { error } = await svc
        .from("social_post_drafts")
        .update({
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: actorId,
        })
        .in("id", draftIds)
        .eq("company_id", companyId)
        .is("archived_at", null);

      if (error) {
        logger.error("batch_ops.delete.draft_archive_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.delete.drafts_archived", { batchId, count: draftIds.length });
      }
    } catch (err) {
      logger.error("batch_ops.delete.draft_archive_threw", {
        batchId,
        err: String(err),
      });
    }
  }

  // ── c. Find open approval requests ───────────────────────────────────────
  let approvalRequestIds: string[] = [];

  try {
    const { data: requests, error } = await svc
      .from("social_approval_requests")
      .select("id")
      .eq("subject_type", "image_batch")
      .eq("subject_id", batchId)
      .is("revoked_at", null)
      .is("final_approved_at", null)
      .is("final_rejected_at", null);

    if (error) {
      logger.error("batch_ops.delete.approval_lookup_failed", {
        batchId,
        err: error.message,
      });
    } else {
      approvalRequestIds = ((requests ?? []) as Array<{ id: string }>).map(
        (r) => r.id,
      );
    }
  } catch (err) {
    logger.error("batch_ops.delete.approval_lookup_threw", {
      batchId,
      err: String(err),
    });
  }

  // ── d. Revoke recipients ──────────────────────────────────────────────────
  if (approvalRequestIds.length > 0) {
    try {
      const { error } = await svc
        .from("social_approval_recipients")
        .update({ revoked_at: new Date().toISOString() })
        .in("approval_request_id", approvalRequestIds)
        .is("revoked_at", null);

      if (error) {
        logger.error("batch_ops.delete.recipient_revoke_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.delete.recipients_revoked", {
          batchId,
          requestCount: approvalRequestIds.length,
        });
      }
    } catch (err) {
      logger.error("batch_ops.delete.recipient_revoke_threw", {
        batchId,
        err: String(err),
      });
    }

    // ── e. Mark approval requests revoked ──────────────────────────────────
    try {
      const { error } = await svc
        .from("social_approval_requests")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", approvalRequestIds);

      if (error) {
        logger.error("batch_ops.delete.approval_revoke_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.delete.approvals_revoked", {
          batchId,
          count: approvalRequestIds.length,
        });
      }
    } catch (err) {
      logger.error("batch_ops.delete.approval_revoke_threw", {
        batchId,
        err: String(err),
      });
    }
  }

  // ── f. Hard-delete image_selections ──────────────────────────────────────
  if (jobIds.length > 0) {
    try {
      const { error } = await svc
        .from("image_selections")
        .delete()
        .in("job_id", jobIds);

      if (error) {
        logger.error("batch_ops.delete.selections_delete_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.delete.selections_deleted", { batchId });
      }
    } catch (err) {
      logger.error("batch_ops.delete.selections_delete_threw", {
        batchId,
        err: String(err),
      });
    }

    // ── g. Hard-delete jobs ───────────────────────────────────────────────
    try {
      const { error } = await svc
        .from("image_generation_jobs")
        .delete()
        .eq("batch_id", batchId)
        .eq("company_id", companyId);

      if (error) {
        logger.error("batch_ops.delete.jobs_delete_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.delete.jobs_deleted", {
          batchId,
          count: jobIds.length,
        });
      }
    } catch (err) {
      logger.error("batch_ops.delete.jobs_delete_threw", {
        batchId,
        err: String(err),
      });
    }
  }

  // ── h. Hard-delete batch ──────────────────────────────────────────────────
  try {
    const { error } = await svc
      .from("image_generation_batches")
      .delete()
      .eq("id", batchId)
      .eq("company_id", companyId);

    if (error) {
      logger.error("batch_ops.delete.batch_delete_failed", {
        batchId,
        err: error.message,
      });
    } else {
      logger.info("batch_ops.delete.batch_deleted", { batchId });
    }
  } catch (err) {
    logger.error("batch_ops.delete.batch_delete_threw", {
      batchId,
      err: String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// resetApprovalToFresh
//
// Revokes approval state and clears selections so a batch can go back through
// the approval cycle. Does NOT delete jobs or the batch itself.
//
// Steps:
//   a. Identify jobs + draft IDs
//   b. Soft-delete attached social_post_drafts
//   c. Find open approval requests
//   d. Revoke approval recipients
//   e. Mark approval requests revoked
//   (no f/g/h hard-deletes)
//   + Clear image_selections so jobs can be re-approved
//   + Reset batch approval_status + review_round to fresh state
//   + Reset job auto_attach_state + auto_attached_draft_id
// ---------------------------------------------------------------------------
export async function resetApprovalToFresh(
  batchId: string,
  companyId: string,
  actorId: string,
): Promise<void> {
  const svc = getServiceRoleClient();

  // ── a. Find all jobs ─────────────────────────────────────────────────────
  let jobIds: string[] = [];
  let draftIds: string[] = [];

  try {
    const { data: jobs, error } = await svc
      .from("image_generation_jobs")
      .select("id, auto_attached_draft_id")
      .eq("batch_id", batchId)
      .eq("company_id", companyId);

    if (error) {
      logger.error("batch_ops.reset.jobs_lookup_failed", {
        batchId,
        err: error.message,
      });
    } else {
      const rows = (jobs ?? []) as Array<{
        id: string;
        auto_attached_draft_id: string | null;
      }>;
      jobIds = rows.map((r) => r.id);
      draftIds = rows
        .map((r) => r.auto_attached_draft_id)
        .filter((id): id is string => id !== null);
    }
  } catch (err) {
    logger.error("batch_ops.reset.jobs_lookup_threw", {
      batchId,
      err: String(err),
    });
  }

  logger.info("batch_ops.reset.jobs_found", {
    batchId,
    jobCount: jobIds.length,
    draftCount: draftIds.length,
  });

  // ── b. Soft-delete attached drafts ───────────────────────────────────────
  if (draftIds.length > 0) {
    try {
      const { error } = await svc
        .from("social_post_drafts")
        .update({
          archived_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: actorId,
        })
        .in("id", draftIds)
        .eq("company_id", companyId)
        .is("archived_at", null);

      if (error) {
        logger.error("batch_ops.reset.draft_archive_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.reset.drafts_archived", { batchId, count: draftIds.length });
      }
    } catch (err) {
      logger.error("batch_ops.reset.draft_archive_threw", {
        batchId,
        err: String(err),
      });
    }
  }

  // ── c. Find open approval requests ───────────────────────────────────────
  let approvalRequestIds: string[] = [];

  try {
    const { data: requests, error } = await svc
      .from("social_approval_requests")
      .select("id")
      .eq("subject_type", "image_batch")
      .eq("subject_id", batchId)
      .is("revoked_at", null)
      .is("final_approved_at", null)
      .is("final_rejected_at", null);

    if (error) {
      logger.error("batch_ops.reset.approval_lookup_failed", {
        batchId,
        err: error.message,
      });
    } else {
      approvalRequestIds = ((requests ?? []) as Array<{ id: string }>).map(
        (r) => r.id,
      );
    }
  } catch (err) {
    logger.error("batch_ops.reset.approval_lookup_threw", {
      batchId,
      err: String(err),
    });
  }

  // ── d. Revoke recipients ──────────────────────────────────────────────────
  if (approvalRequestIds.length > 0) {
    try {
      const { error } = await svc
        .from("social_approval_recipients")
        .update({ revoked_at: new Date().toISOString() })
        .in("approval_request_id", approvalRequestIds)
        .is("revoked_at", null);

      if (error) {
        logger.error("batch_ops.reset.recipient_revoke_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.reset.recipients_revoked", {
          batchId,
          requestCount: approvalRequestIds.length,
        });
      }
    } catch (err) {
      logger.error("batch_ops.reset.recipient_revoke_threw", {
        batchId,
        err: String(err),
      });
    }

    // ── e. Mark approval requests revoked ──────────────────────────────────
    try {
      const { error } = await svc
        .from("social_approval_requests")
        .update({ revoked_at: new Date().toISOString() })
        .in("id", approvalRequestIds);

      if (error) {
        logger.error("batch_ops.reset.approval_revoke_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.reset.approvals_revoked", {
          batchId,
          count: approvalRequestIds.length,
        });
      }
    } catch (err) {
      logger.error("batch_ops.reset.approval_revoke_threw", {
        batchId,
        err: String(err),
      });
    }
  }

  // ── Clear image_selections for all jobs ───────────────────────────────────
  if (jobIds.length > 0) {
    try {
      const { error } = await svc
        .from("image_selections")
        .delete()
        .in("job_id", jobIds);

      if (error) {
        logger.error("batch_ops.reset.selections_clear_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.reset.selections_cleared", { batchId });
      }
    } catch (err) {
      logger.error("batch_ops.reset.selections_clear_threw", {
        batchId,
        err: String(err),
      });
    }
  }

  // ── Reset batch approval_status + review_round ────────────────────────────
  try {
    const { error } = await svc
      .from("image_generation_batches")
      .update({
        approval_status: "none",
        review_round: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batchId)
      .eq("company_id", companyId);

    if (error) {
      logger.error("batch_ops.reset.batch_status_reset_failed", {
        batchId,
        err: error.message,
      });
    } else {
      logger.info("batch_ops.reset.batch_status_reset", { batchId });
    }
  } catch (err) {
    logger.error("batch_ops.reset.batch_status_reset_threw", {
      batchId,
      err: String(err),
    });
  }

  // ── Reset job auto-attach state ───────────────────────────────────────────
  if (jobIds.length > 0) {
    try {
      const { error } = await svc
        .from("image_generation_jobs")
        .update({
          auto_attach_state: null,
          auto_attached_draft_id: null,
        })
        .eq("batch_id", batchId)
        .eq("company_id", companyId);

      if (error) {
        logger.error("batch_ops.reset.jobs_attach_reset_failed", {
          batchId,
          err: error.message,
        });
      } else {
        logger.info("batch_ops.reset.jobs_attach_reset", {
          batchId,
          count: jobIds.length,
        });
      }
    } catch (err) {
      logger.error("batch_ops.reset.jobs_attach_reset_threw", {
        batchId,
        err: String(err),
      });
    }
  }
}
