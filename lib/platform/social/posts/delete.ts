import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-3 — hard delete a draft social_post_master.
//
// V1 only allows deletes while state='draft'. Once a post enters the
// approval / scheduling pipeline it has audit value (snapshots,
// approval events, schedule entries, publish attempts) and a hard
// delete would orphan dependent rows. Non-draft deletes are rejected
// with INVALID_STATE; the right path is to revoke the approval
// request / cancel the schedule (later slices).
//
// The atomic predicate `WHERE id=? AND company_id=? AND state='draft'`
// makes concurrent submit_for_approval + delete safe — only one
// transition wins.
//
// Caller is responsible for canDo("edit_post", company_id).
// ---------------------------------------------------------------------------

export async function deletePostMaster(args: {
  postId: string;
  companyId: string;
}): Promise<ApiResponse<{ deleted: true }>> {
  if (!args.postId) return validation("Post id is required.");
  if (!args.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  const lookup = await svc
    .from("social_post_master")
    .select("state")
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .maybeSingle();

  if (lookup.error) {
    logger.error("social.posts.delete.lookup_failed", {
      err: lookup.error.message,
      post_id: args.postId,
    });
    return internal(`Failed to read post: ${lookup.error.message}`);
  }
  if (!lookup.data) return notFound();

  if (lookup.data.state !== "draft") {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: `Only drafts can be deleted. Current state: ${lookup.data.state}.`,
        retryable: false,
        suggested_action:
          "Cancel the schedule or revoke the approval request instead.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const del = await svc
    .from("social_post_master")
    .delete()
    .eq("id", args.postId)
    .eq("company_id", args.companyId)
    .eq("state", "draft")
    .select("id")
    .maybeSingle();

  if (del.error) {
    logger.error("social.posts.delete.failed", {
      err: del.error.message,
      code: del.error.code,
      post_id: args.postId,
    });
    return internal(`Failed to delete post: ${del.error.message}`);
  }

  if (!del.data) {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message:
          "The post moved out of 'draft' before the delete landed. Refresh and try again.",
        retryable: true,
        suggested_action: "Reload the page.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    ok: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<{ deleted: true }> {
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

function notFound(): ApiResponse<{ deleted: true }> {
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

function internal(message: string): ApiResponse<{ deleted: true }> {
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
