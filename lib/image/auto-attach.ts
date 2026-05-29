import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// B4 — auto-attach a selected image to a scheduled social_post_draft.
//
// §1.5 of MASS_IMAGE_GEN_BUILD_BRIEF: when an operator approves an image-gen
// job whose source row carried a target_publish_date, the image attaches to
// the scheduled draft for (company, publish_date).
//
// §1.6: attachments write asset references, not signed URLs. The publish
// layer signs URLs at publish time from the storage path. The attach path
// here therefore only writes:
//   - a social_media_assets row (storage_path + bytes/mime/dims/company)
//   - the asset's UUID appended to social_post_drafts.media_asset_ids
//
// Fail-soft contract: this function MUST NOT throw. Any error is logged and
// reflected in image_generation_jobs.auto_attach_state ('attach_failed').
// The approval action is never blocked by an attach failure.
// ---------------------------------------------------------------------------

export type AutoAttachState = "not_applicable" | "pending" | "attached" | "attach_failed";

export interface AutoAttachResult {
  state: AutoAttachState;
  draftId?: string;
  assetId?: string;
  error?: string;
}

export interface AutoAttachInput {
  jobId: string;
  companyId: string;
  approvedBy: string; // platform_users.id of the approving operator
}

export async function autoAttachImage(input: AutoAttachInput): Promise<AutoAttachResult> {
  const svc = getServiceRoleClient();

  try {
    // ─── Load the job ────────────────────────────────────────────────────
    const { data: job, error: jobErr } = await svc
      .from("image_generation_jobs")
      .select(
        "id, company_id, state, result_storage_path, target_publish_date, generation_params",
      )
      .eq("id", input.jobId)
      .maybeSingle();

    if (jobErr || !job) {
      const reason = jobErr?.message ?? "job not found";
      logger.warn("image.auto_attach.job_missing", { jobId: input.jobId, err: reason });
      return { state: "attach_failed", error: reason };
    }

    const j = job as {
      id: string;
      company_id: string;
      state: string;
      result_storage_path: string | null;
      target_publish_date: string | null;
      generation_params: Record<string, unknown>;
    };

    if (j.company_id !== input.companyId) {
      // Defence-in-depth: caller should already have validated tenancy.
      const reason = "company_id mismatch";
      logger.warn("image.auto_attach.tenant_mismatch", { jobId: input.jobId });
      await markJobAttachState(svc, input.jobId, "attach_failed", null, reason);
      return { state: "attach_failed", error: reason };
    }

    // No publish date → nothing to attach to. Mark not_applicable and return.
    if (!j.target_publish_date) {
      await markJobAttachState(svc, input.jobId, "not_applicable", null, null);
      return { state: "not_applicable" };
    }

    if (j.state !== "completed" || !j.result_storage_path) {
      const reason = `job not in attachable state: state=${j.state} result_storage_path=${j.result_storage_path ?? "null"}`;
      logger.warn("image.auto_attach.job_not_ready", { jobId: input.jobId, reason });
      await markJobAttachState(svc, input.jobId, "attach_failed", null, reason);
      return { state: "attach_failed", error: reason };
    }

    // Mark pending — the attach is in flight.
    await markJobAttachState(svc, input.jobId, "pending", null, null);

    // ─── Step 1: create social_media_assets row ─────────────────────────
    // dims live on the job's generation_params (best-effort; the schema
    // does not require width/height).
    const params = j.generation_params as { aspectRatio?: string };
    const { width, height } = aspectRatioToDimensions(params.aspectRatio);
    const mimeType = guessMimeType(j.result_storage_path);

    const { data: asset, error: assetErr } = await svc
      .from("social_media_assets")
      .insert({
        company_id: input.companyId,
        storage_path: j.result_storage_path,
        mime_type: mimeType,
        bytes: 0, // unknown without an HTTP HEAD; acceptable per brief §B4
        width,
        height,
        uploaded_by: input.approvedBy,
      })
      .select("id")
      .single();

    if (assetErr || !asset) {
      const reason = assetErr?.message ?? "asset insert returned no row";
      logger.warn("image.auto_attach.asset_insert_failed", {
        jobId: input.jobId,
        err: reason,
      });
      await markJobAttachState(svc, input.jobId, "attach_failed", null, reason);
      return { state: "attach_failed", error: reason };
    }

    const assetId = (asset as { id: string }).id;

    // ─── Step 2: find or create the scheduled draft ──────────────────────
    const draftId = await findOrCreateScheduledDraft(svc, {
      companyId: input.companyId,
      publishDate: j.target_publish_date,
      approvedBy: input.approvedBy,
    });

    if (!draftId) {
      const reason = "find/create draft failed";
      await markJobAttachState(svc, input.jobId, "attach_failed", null, reason);
      return { state: "attach_failed", error: reason };
    }

    // ─── Step 3: append assetId to media_asset_ids ───────────────────────
    // Read-modify-write with the service-role client. Concurrent attach
    // calls for the same draft can race — the worst case is a duplicated
    // asset id in the array, which the publish-layer dedupes when it
    // resolves URLs. Acceptable per §B4.
    const { data: draft, error: readErr } = await svc
      .from("social_post_drafts")
      .select("media_asset_ids")
      .eq("id", draftId)
      .maybeSingle();

    if (readErr || !draft) {
      const reason = readErr?.message ?? "draft disappeared between create and update";
      logger.warn("image.auto_attach.draft_read_failed", {
        jobId: input.jobId,
        draftId,
        err: reason,
      });
      await markJobAttachState(svc, input.jobId, "attach_failed", null, reason);
      return { state: "attach_failed", error: reason };
    }

    const existingIds = ((draft as { media_asset_ids: string[] | null }).media_asset_ids) ?? [];
    const nextIds = existingIds.includes(assetId) ? existingIds : [...existingIds, assetId];

    const { error: updErr } = await svc
      .from("social_post_drafts")
      .update({ media_asset_ids: nextIds, updated_at: new Date().toISOString() })
      .eq("id", draftId);

    if (updErr) {
      logger.warn("image.auto_attach.draft_update_failed", {
        jobId: input.jobId,
        draftId,
        err: updErr.message,
      });
      await markJobAttachState(svc, input.jobId, "attach_failed", draftId, updErr.message);
      return { state: "attach_failed", error: updErr.message, draftId, assetId };
    }

    // ─── Step 4: mark attached ───────────────────────────────────────────
    await markJobAttachState(svc, input.jobId, "attached", draftId, null);
    logger.info("image.auto_attach.attached", {
      jobId: input.jobId,
      companyId: input.companyId,
      draftId,
      assetId,
    });

    return { state: "attached", draftId, assetId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("image.auto_attach.unexpected", { jobId: input.jobId, err: reason });
    // Best-effort mark; ignore failure of the mark itself.
    await markJobAttachState(svc, input.jobId, "attach_failed", null, reason).catch(() => {});
    return { state: "attach_failed", error: reason };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markJobAttachState(
  svc: ReturnType<typeof getServiceRoleClient>,
  jobId: string,
  state: AutoAttachState,
  draftId: string | null,
  errorDetail: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = { auto_attach_state: state };
  if (draftId !== null) patch.auto_attached_draft_id = draftId;
  // We piggyback on the existing error_detail column for diagnostic context
  // on failed attaches. The qstash handler only writes error_detail on
  // state in ('failed','escalated'); 'completed' jobs don't touch it.
  if (errorDetail && state === "attach_failed") {
    patch.error_detail = errorDetail.slice(0, 500);
  }
  const { error } = await svc.from("image_generation_jobs").update(patch).eq("id", jobId);
  if (error) {
    logger.warn("image.auto_attach.mark_state_failed", {
      jobId,
      state,
      err: error.message,
    });
  }
}

interface FindOrCreateDraftInput {
  companyId: string;
  publishDate: string; // YYYY-MM-DD
  approvedBy: string;
}

async function findOrCreateScheduledDraft(
  svc: ReturnType<typeof getServiceRoleClient>,
  input: FindOrCreateDraftInput,
): Promise<string | null> {
  // Normalise publish_date → scheduled_at = midnight UTC of that day.
  const scheduledAtIso = `${input.publishDate}T00:00:00.000Z`;

  // Look for an existing scheduled draft for (company, publish_date).
  // Match by scheduled_at exact equality + state='scheduled' + not archived.
  const { data: existing, error: lookupErr } = await svc
    .from("social_post_drafts")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("scheduled_at", scheduledAtIso)
    .eq("state", "scheduled")
    .is("archived_at", null)
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    logger.warn("image.auto_attach.draft_lookup_failed", {
      companyId: input.companyId,
      publishDate: input.publishDate,
      err: lookupErr.message,
    });
    return null;
  }

  if (existing) {
    return (existing as { id: string }).id;
  }

  // Create a placeholder scheduled draft. Empty content + empty target_profiles;
  // the operator will fill those in later. created_by/updated_by are required
  // FKs to auth.users; we pass the approver's id.
  const { data: created, error: createErr } = await svc
    .from("social_post_drafts")
    .insert({
      company_id: input.companyId,
      created_by: input.approvedBy,
      updated_by: input.approvedBy,
      state: "scheduled",
      content: "",
      media_urls: [],
      media_asset_ids: [],
      target_profiles: [],
      platform_variants: {},
      scheduled_at: scheduledAtIso,
      approval_required: false,
    })
    .select("id")
    .single();

  if (createErr || !created) {
    logger.warn("image.auto_attach.draft_create_failed", {
      companyId: input.companyId,
      publishDate: input.publishDate,
      err: createErr?.message,
    });
    return null;
  }

  return (created as { id: string }).id;
}

function aspectRatioToDimensions(ratio: string | undefined): {
  width: number | null;
  height: number | null;
} {
  // Best-effort: the canonical Ideogram dimensions for each ratio at the
  // "1024 short edge" sizing the pipeline uses. Returning null is acceptable
  // (the schema does not require width/height).
  switch (ratio) {
    case "1x1":
      return { width: 1024, height: 1024 };
    case "4x5":
      return { width: 1024, height: 1280 };
    case "9x16":
      return { width: 720, height: 1280 };
    case "16x9":
      return { width: 1280, height: 720 };
    case "4x3":
      return { width: 1024, height: 768 };
    default:
      return { width: null, height: null };
  }
}

function guessMimeType(storagePath: string): string {
  const lower = storagePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
