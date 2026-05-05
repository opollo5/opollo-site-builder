import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import {
  SUPPORTED_PLATFORMS,
  type ListVariantsInput,
  type ListVariantsResult,
  type PostVariant,
  type ResolvedVariant,
  type SocialPlatform,
} from "./types";

// ---------------------------------------------------------------------------
// S1-4 — list variants for a post.
//
// Returns:
//   - The parent post's state + master_text (for UI fallback display).
//   - One ResolvedVariant per supported platform. If a platform has no
//     variant row yet, `variant` is null and `effective_text` falls back
//     to master_text.
//
// Scoping: the parent post must belong to companyId. NOT_FOUND if not.
// Service-role bypasses RLS; the lib's company_id filter is the
// authoritative scope.
// ---------------------------------------------------------------------------

export async function listVariants(
  input: ListVariantsInput,
): Promise<ApiResponse<ListVariantsResult>> {
  if (!input.postMasterId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  const post = await svc
    .from("social_post_master")
    .select("id, state, master_text")
    .eq("id", input.postMasterId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (post.error) {
    logger.error("social.variants.list.post_lookup_failed", {
      err: post.error.message,
      post_id: input.postMasterId,
    });
    return internal(`Failed to read post: ${post.error.message}`);
  }
  if (!post.data) return notFound();

  const variants = await svc
    .from("social_post_variant")
    .select(
      "id, post_master_id, platform, connection_id, variant_text, is_custom, scheduled_at, media_asset_ids, created_at, updated_at",
    )
    .eq("post_master_id", input.postMasterId);

  if (variants.error) {
    logger.error("social.variants.list.failed", {
      err: variants.error.message,
      post_id: input.postMasterId,
    });
    return internal(`Failed to list variants: ${variants.error.message}`);
  }

  const byPlatform = new Map<SocialPlatform, PostVariant>();
  for (const row of variants.data ?? []) {
    byPlatform.set(row.platform as SocialPlatform, row as PostVariant);
  }

  const masterText = (post.data.master_text as string | null) ?? null;

  const resolved: ResolvedVariant[] = SUPPORTED_PLATFORMS.map((platform) => {
    const variant = byPlatform.get(platform) ?? null;
    const effective_text = variant?.is_custom
      ? variant.variant_text
      : masterText;
    return { platform, variant, effective_text };
  });

  return {
    ok: true,
    data: {
      postState: post.data.state as ListVariantsResult["postState"],
      masterText,
      resolved,
    },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<ListVariantsResult> {
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

function notFound(): ApiResponse<ListVariantsResult> {
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

function internal(message: string): ApiResponse<ListVariantsResult> {
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
