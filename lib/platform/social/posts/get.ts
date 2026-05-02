import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { PostMaster } from "./types";

// ---------------------------------------------------------------------------
// S1-1 — fetch one social_post_master row.
//
// Returns NOT_FOUND when the row doesn't exist OR doesn't belong to the
// supplied companyId. Hiding the difference is deliberate — opollo
// staff get the same envelope (they can verify cross-company existence
// out-of-band via the staff console). Customer admins should never see
// a "this post belongs to a different company" leak.
// ---------------------------------------------------------------------------

export async function getPostMaster(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<PostMaster>> {
  if (!args.postId) {
    return validation("Post id is required.");
  }
  if (!args.companyId) {
    return validation("Company id is required.");
  }

  const svc = getServiceRoleClient();
  const result = await svc
    .from("social_post_master")
    .select(
      "id, company_id, state, source_type, master_text, link_url, created_by, created_at, updated_at, state_changed_at",
    )
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .maybeSingle();

  if (result.error) {
    logger.error("social.posts.get.failed", {
      err: result.error.message,
      post_id: args.postId,
    });
    return internal(`Failed to read post: ${result.error.message}`);
  }

  if (!result.data) {
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

  return {
    ok: true,
    data: result.data as PostMaster,
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<PostMaster> {
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

function internal(message: string): ApiResponse<PostMaster> {
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
