import "server-only";

import { fromZonedTime } from "date-fns-tz";
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
  /**
   * IANA timezone for the company (e.g. "Australia/Melbourne").
   * Fetched by the caller (select route) which already has companyId.
   * Used to anchor bulk auto-attach scheduled_at to company-local midnight.
   * Defaults to "UTC" inside the function if absent.
   */
  companyTimezone?: string;
}

export async function autoAttachImage(input: AutoAttachInput): Promise<AutoAttachResult> {
  const svc = getServiceRoleClient();

  try {
    // ─── Load the job ────────────────────────────────────────────────────
    const { data: job, error: jobErr } = await svc
      .from("image_generation_jobs")
      .select(
        "id, company_id, state, result_storage_path, target_publish_date, generation_params, post_text, target_platforms",
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
      post_text: string | null;
      target_platforms: string[] | null;
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

    // ─── Step 2: create a new scheduled draft ────────────────────────────
    // ALWAYS inserts a new draft — never finds an existing one. Each approved
    // image creates its own post: separate image, separate caption, separate
    // channel selection, and scheduled_at anchored to company midnight.
    // The asset is included directly in the INSERT — one atomic operation.
    const draftId = await createScheduledDraft(svc, {
      companyId: input.companyId,
      publishDate: j.target_publish_date,
      approvedBy: input.approvedBy,
      postText: j.post_text ?? null,
      targetPlatforms: (j.target_platforms as string[] | null) ?? [],
      companyTimezone: input.companyTimezone ?? "UTC",
      assetId,
    });

    if (!draftId) {
      const reason = "draft creation failed";
      await markJobAttachState(svc, input.jobId, "attach_failed", null, reason);
      return { state: "attach_failed", error: reason };
    }

    // ─── Step 3: mark job attached ───────────────────────────────────────
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

// ---------------------------------------------------------------------------
// Platform code → social_connections.platform resolution
//
// Spreadsheet target_platforms use generic codes ("linkedin", "facebook").
// social_connections.platform uses bundle.social-specific sub-types.
// This map defines which DB platform values satisfy each generic code,
// ordered by PREFERENCE: business/company pages first, personal pages last.
//
// Preference rule (baked in per spec):
//   If a company has BOTH linkedin_personal AND linkedin_company, use
//   linkedin_company — the normal business-posting target. The same
//   "prefer company/business account over personal" logic applies to
//   any platform that has a personal vs business variant.
// ---------------------------------------------------------------------------

type DbPlatform = "linkedin_personal" | "linkedin_company" | "facebook_page"
  | "instagram_business" | "x" | "gbp";

const GENERIC_TO_DB_PLATFORMS: Record<string, DbPlatform[]> = {
  // Business page preferred over personal page.
  linkedin:           ["linkedin_company", "linkedin_personal"],
  linkedin_landscape: ["linkedin_company", "linkedin_personal"],
  // Only one DB variant per platform below.
  instagram:          ["instagram_business"],
  instagram_story:    ["instagram_business"],
  facebook:           ["facebook_page"],
  facebook_story:     ["facebook_page"],
  x:                  ["x"],
  gbp:                ["gbp"],
};

interface ResolvedConnection {
  profile_id: string;
  platform: string;
  account_name: string | null;
  account_avatar_url: string | null;
}

/**
 * Resolve generic platform codes to the company's connected social accounts.
 *
 * For each generic code, picks the highest-priority connected DB platform
 * (business over personal). Silently skips platforms the company hasn't
 * connected. Returns [] if the lookup fails (fail-soft contract).
 */
async function resolveTargetConnections(
  svc: ReturnType<typeof getServiceRoleClient>,
  companyId: string,
  genericPlatformCodes: string[],
): Promise<ResolvedConnection[]> {
  // Collect the unique set of DB platform values needed across all codes.
  const dbPlatformsNeeded = new Set<DbPlatform>();
  for (const code of genericPlatformCodes) {
    for (const dbP of GENERIC_TO_DB_PLATFORMS[code] ?? []) {
      dbPlatformsNeeded.add(dbP);
    }
  }

  if (dbPlatformsNeeded.size === 0) return [];

  const { data, error } = await svc
    .from("social_connections")
    .select("id, platform, display_name, avatar_url")
    .eq("company_id", companyId)
    .in("platform", [...dbPlatformsNeeded])
    .neq("status", "disconnected");

  if (error) {
    logger.warn("image.auto_attach.connections_lookup_failed", {
      companyId,
      err: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as Array<{
    id: string;
    platform: string;
    display_name: string | null;
    avatar_url: string | null;
  }>;

  // Build a map of dbPlatform → connection row (one per platform sub-type).
  const byDbPlatform = new Map<string, (typeof rows)[0]>();
  for (const row of rows) {
    byDbPlatform.set(row.platform, row);
  }

  // For each generic code, pick the highest-priority matching connection.
  // Deduplicate by connection id so two generic codes that resolve to the
  // same DB platform (e.g. linkedin + linkedin_landscape) don't add duplicates.
  const seen = new Set<string>();
  const resolved: ResolvedConnection[] = [];

  for (const code of genericPlatformCodes) {
    const candidates = GENERIC_TO_DB_PLATFORMS[code] ?? [];
    for (const dbPlatform of candidates) {
      const conn = byDbPlatform.get(dbPlatform);
      if (conn && !seen.has(conn.id)) {
        seen.add(conn.id);
        resolved.push({
          profile_id: conn.id,
          platform: conn.platform,
          account_name: conn.display_name,
          account_avatar_url: conn.avatar_url,
        });
        break; // highest-priority match found for this generic code
      }
    }
  }

  return resolved;
}

interface CreateDraftInput {
  companyId: string;
  publishDate: string; // YYYY-MM-DD
  approvedBy: string;
  /** AI-generated social caption from the source spreadsheet row. */
  postText: string | null;
  /** Generic platform codes — resolved to connected social_connections. */
  targetPlatforms: string[];
  /**
   * IANA timezone for the company (e.g. "Australia/Melbourne").
   * Used to anchor midnight to the company's local date — "June 14"
   * becomes June 14 00:00 in the company timezone, not UTC.
   */
  companyTimezone: string;
  /** Asset UUID to attach — included directly in the INSERT. */
  assetId: string;
}

/**
 * Always inserts a new social_post_drafts row — never finds an existing one.
 *
 * Each approved image creates its own post: its own image, caption, channel
 * selection, and date. Re-uploading the same spreadsheet row = a separate
 * post per approval, not an update to an existing one. This eliminates the
 * stacking problem (multiple aspect-ratio variants collapsing onto one draft)
 * and the silent-update problem (a second approval silently replacing an
 * operator-edited draft).
 *
 * The asset is included in the INSERT so there is no separate Step 3
 * read-modify-write — the draft is fully populated in one operation.
 */
async function createScheduledDraft(
  svc: ReturnType<typeof getServiceRoleClient>,
  input: CreateDraftInput,
): Promise<string | null> {
  // Normalise publish_date → scheduled_at = midnight in the COMPANY timezone.
  // "June 14" means June 14 00:00 in the company timezone, not UTC midnight.
  const scheduledAtIso = fromZonedTime(
    `${input.publishDate}T00:00:00`,
    input.companyTimezone,
  ).toISOString();

  const resolvedConnections = await resolveTargetConnections(
    svc,
    input.companyId,
    input.targetPlatforms,
  );

  const connectionIds = resolvedConnections.map((c) => c.profile_id);

  const { data: created, error: createErr } = await svc
    .from("social_post_drafts")
    .insert({
      company_id: input.companyId,
      created_by: input.approvedBy,
      updated_by: input.approvedBy,
      state: "scheduled",
      content: input.postText ?? "",
      media_urls: [],
      media_asset_ids: [input.assetId],
      target_profiles: resolvedConnections,
      platform_variants: {},
      scheduled_at: scheduledAtIso,
      approval_required: false,
      draft_data: connectionIds.length > 0
        ? { target_connection_ids: connectionIds }
        : {},
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
