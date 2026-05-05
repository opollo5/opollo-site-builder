import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { PostMaster } from "./types";

// ---------------------------------------------------------------------------
// S1-3 — partial update of social_post_master.
//
// V1 only allows edits while state='draft'. Once the post enters the
// approval / scheduling / publishing pipelines its content is part of
// the snapshot contract; later slices will define a separate "request
// changes → revision" flow that re-opens the draft. For now, edits on
// non-draft posts are rejected with INVALID_STATE.
//
// Atomic write: UPDATE ... WHERE id=? AND company_id=? AND state='draft'.
// If the row's state moved out of 'draft' between the lib's lookup and
// the UPDATE (race with submit_for_approval), the predicate fails the
// match and we surface INVALID_STATE.
//
// Caller is responsible for the canDo("edit_post", company_id) gate.
// ---------------------------------------------------------------------------

const MASTER_TEXT_MAX = 10_000;
const LINK_URL_MAX = 2048;

export type UpdatePostMasterInput = {
  postId: string;
  companyId: string;
  // Partial — undefined means "leave unchanged"; null means "clear".
  // The route schema can map empty-string → null at the request layer
  // for ergonomics; the lib treats them as different signals.
  masterText?: string | null;
  linkUrl?: string | null;
};

export async function updatePostMaster(
  input: UpdatePostMasterInput,
): Promise<ApiResponse<PostMaster>> {
  if (!input.postId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");

  const patch: { master_text?: string | null; link_url?: string | null } = {};

  if (input.masterText !== undefined) {
    const cleaned = normaliseText(input.masterText);
    if (cleaned !== null && cleaned.length > MASTER_TEXT_MAX) {
      return validation(
        `master_text must be ${MASTER_TEXT_MAX} characters or fewer.`,
      );
    }
    patch.master_text = cleaned;
  }

  if (input.linkUrl !== undefined) {
    const cleaned = normaliseText(input.linkUrl);
    if (cleaned !== null) {
      if (cleaned.length > LINK_URL_MAX) {
        return validation(
          `link_url must be ${LINK_URL_MAX} characters or fewer.`,
        );
      }
      if (!isHttpUrl(cleaned)) {
        return validation("link_url must be a valid http(s) URL.");
      }
    }
    patch.link_url = cleaned;
  }

  if (Object.keys(patch).length === 0) {
    return validation("At least one field must be supplied to update.");
  }

  // Compute the post-update content guard using the resolved patch +
  // current row, but easier: enforce "at least one of master_text /
  // link_url is non-null after update" via a follow-up read. The simpler
  // way is to look up the row, merge in memory, and reject upfront if
  // the merged result violates the rule. Worth it for the symmetry with
  // create.ts.
  const svc = getServiceRoleClient();

  const lookup = await svc
    .from("social_post_master")
    .select("master_text, link_url, state, company_id")
    .eq("id", input.postId)
    .eq("company_id", input.companyId)
    .maybeSingle();

  if (lookup.error) {
    logger.error("social.posts.update.lookup_failed", {
      err: lookup.error.message,
      post_id: input.postId,
    });
    return internal(`Failed to read post: ${lookup.error.message}`);
  }
  if (!lookup.data) return notFound();

  if (lookup.data.state !== "draft") {
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: `Posts can only be edited while in 'draft'. Current state: ${lookup.data.state}.`,
        retryable: false,
        suggested_action:
          "Reopen the draft first (revision flow lands in a future slice).",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const mergedText =
    "master_text" in patch ? patch.master_text : (lookup.data.master_text as string | null);
  const mergedLink =
    "link_url" in patch ? patch.link_url : (lookup.data.link_url as string | null);
  if (mergedText === null && mergedLink === null) {
    return validation(
      "A post must have at least master_text or link_url after the update.",
    );
  }

  const update = await svc
    .from("social_post_master")
    .update(patch)
    .eq("id", input.postId)
    .eq("company_id", input.companyId)
    .eq("state", "draft")
    .select(
      "id, company_id, state, source_type, master_text, link_url, created_by, created_at, updated_at, state_changed_at",
    )
    .maybeSingle();

  if (update.error) {
    logger.error("social.posts.update.failed", {
      err: update.error.message,
      code: update.error.code,
      post_id: input.postId,
    });
    return internal(`Failed to update post: ${update.error.message}`);
  }

  if (!update.data) {
    // Either the row was deleted between lookup + update OR state moved
    // out of 'draft'. Both are race losses; INVALID_STATE captures both
    // because the user's request can't proceed regardless.
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message:
          "The post moved out of 'draft' before the edit landed. Refresh and try again.",
        retryable: true,
        suggested_action: "Reload the page.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    ok: true,
    data: update.data as PostMaster,
    timestamp: new Date().toISOString(),
  };
}

function normaliseText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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

function notFound(): ApiResponse<PostMaster> {
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
