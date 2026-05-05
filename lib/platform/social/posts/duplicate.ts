import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-36 — duplicate a social_post_master row + its variants into a new draft.
//
// Copies master_text, link_url, and all custom variant overrides
// (variant_text, is_custom, media_asset_ids). Does NOT copy connection_id
// or scheduled_at — the duplicate starts clean in draft state.
// ---------------------------------------------------------------------------

export async function duplicatePost(input: {
  postId: string;
  companyId: string;
  userId: string;
}): Promise<ApiResponse<{ newPostId: string }>> {
  if (!input.postId || !input.companyId || !input.userId) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "postId, companyId, and userId are required.",
        retryable: false,
        suggested_action: "Fix the input.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const svc = getServiceRoleClient();

  // Read source post, scoped to company.
  const source = await svc
    .from("social_post_master")
    .select("id, company_id, master_text, link_url")
    .eq("id", input.postId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (source.error) {
    return internal(`Failed to read source post: ${source.error.message}`);
  }
  if (!source.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Post not found.",
        retryable: false,
        suggested_action: "Check the post ID.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Read source variants.
  const variants = await svc
    .from("social_post_variant")
    .select("platform, variant_text, is_custom, media_asset_ids")
    .eq("post_master_id", input.postId);

  if (variants.error) {
    return internal(`Failed to read variants: ${variants.error.message}`);
  }

  // Create the new post master.
  const newMaster = await svc
    .from("social_post_master")
    .insert({
      company_id: input.companyId,
      state: "draft",
      master_text: source.data.master_text,
      link_url: source.data.link_url,
      created_by: input.userId,
    })
    .select("id")
    .single();

  if (newMaster.error) {
    return internal(`Failed to create duplicate post: ${newMaster.error.message}`);
  }

  const newPostId = newMaster.data.id as string;

  // Copy variants if any exist.
  if (variants.data && variants.data.length > 0) {
    const variantRows = variants.data.map((v) => ({
      post_master_id: newPostId,
      platform: v.platform,
      variant_text: v.variant_text,
      is_custom: v.is_custom,
      media_asset_ids: v.media_asset_ids ?? [],
    }));

    const variantInsert = await svc
      .from("social_post_variant")
      .insert(variantRows);

    if (variantInsert.error) {
      return internal(`Post created but variants failed to copy: ${variantInsert.error.message}`);
    }
  }

  return {
    ok: true,
    data: { newPostId },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<{ newPostId: string }> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: true,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
