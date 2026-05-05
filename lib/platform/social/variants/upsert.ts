import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import {
  SUPPORTED_PLATFORMS,
  type PostVariant,
  type SocialPlatform,
  type UpsertVariantInput,
} from "./types";

// ---------------------------------------------------------------------------
// S1-4 — upsert one variant per (post_master_id, platform).
//
// Idempotent on the schema-enforced UNIQUE (post_master_id, platform):
// Postgres ON CONFLICT updates the existing row instead of inserting.
//
// is_custom is derived from variantText:
//   - non-null/non-empty → is_custom=true (user authored an override)
//   - null/empty         → is_custom=false (clear override; fall back
//     to master_text on send)
//
// State guard: only allowed when the parent post is in 'draft'. Once
// the post enters approval/scheduling, variants are part of the
// snapshot contract.
//
// Caller is responsible for canDo("edit_post", company_id).
// ---------------------------------------------------------------------------

const VARIANT_TEXT_MAX = 10_000;

export async function upsertVariant(
  input: UpsertVariantInput,
): Promise<ApiResponse<PostVariant>> {
  if (!input.postMasterId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");
  if (!SUPPORTED_PLATFORMS.includes(input.platform)) {
    return validation(`Unsupported platform: ${input.platform}.`);
  }

  const cleaned = normaliseText(input.variantText);
  if (cleaned !== null && cleaned.length > VARIANT_TEXT_MAX) {
    return validation(
      `variant_text must be ${VARIANT_TEXT_MAX} characters or fewer.`,
    );
  }

  const svc = getServiceRoleClient();

  // S1-24: validate media_asset_ids belong to this company. We require
  // every passed id to resolve before doing the upsert so a malicious
  // payload can't attach assets the operator doesn't own.
  if (input.mediaAssetIds && input.mediaAssetIds.length > 0) {
    const assets = await svc
      .from("social_media_assets")
      .select("id")
      .eq("company_id", input.companyId)
      .in("id", input.mediaAssetIds);
    if (assets.error) {
      return internal(`Asset check failed: ${assets.error.message}`);
    }
    const foundIds = new Set((assets.data ?? []).map((a) => a.id as string));
    const missing = input.mediaAssetIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return validation(
        `Unknown media asset id(s) for this company: ${missing.join(", ")}.`,
      );
    }
  }

  // Verify parent post exists in this company AND is still a draft.
  const parent = await svc
    .from("social_post_master")
    .select("id, state")
    .eq("id", input.postMasterId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (parent.error) {
    logger.error("social.variants.upsert.parent_lookup_failed", {
      err: parent.error.message,
      post_id: input.postMasterId,
    });
    return internal(`Failed to read post: ${parent.error.message}`);
  }
  if (!parent.data) return notFound();

  if (parent.data.state !== "draft") {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: `Variants can only be edited while the post is in 'draft'. Current state: ${parent.data.state}.`,
        retryable: false,
        suggested_action:
          "Reopen the draft first (revision flow lands in a future slice).",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const isCustom = cleaned !== null;

  // Postgres upsert: insert-or-update on the UNIQUE (post_master_id,
  // platform) constraint. Two concurrent calls converge to one row.
  // media_asset_ids is included only when the caller passed it,
  // preserving the existing array on text-only edits.
  const row: Record<string, unknown> = {
    post_master_id: input.postMasterId,
    platform: input.platform,
    variant_text: cleaned,
    is_custom: isCustom,
  };
  if (input.mediaAssetIds !== undefined) {
    row.media_asset_ids = input.mediaAssetIds;
  }
  const upsert = await svc
    .from("social_post_variant")
    .upsert(row, { onConflict: "post_master_id,platform" })
    .select(
      "id, post_master_id, platform, connection_id, variant_text, is_custom, scheduled_at, media_asset_ids, created_at, updated_at",
    )
    .single();

  if (upsert.error) {
    logger.error("social.variants.upsert.failed", {
      err: upsert.error.message,
      code: upsert.error.code,
      post_id: input.postMasterId,
      platform: input.platform,
    });
    return internal(`Failed to upsert variant: ${upsert.error.message}`);
  }

  return {
    ok: true,
    data: upsert.data as PostVariant,
    timestamp: new Date().toISOString(),
  };
}

function normaliseText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validation(message: string): ApiResponse<PostVariant> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      suggested_action: "Fix the input and resubmit.",
    },
    timestamp: new Date().toISOString(),
  };
}

function notFound(): ApiResponse<PostVariant> {
  return {
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "No post with that id in this company.",
      retryable: false,
      suggested_action: "Check the post id.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<PostVariant> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// `Variant` is what the caller cares about; re-export for ergonomic
// imports (no need to dive into types.ts for a public surface).
// ---------------------------------------------------------------------------
export type { PostVariant };
