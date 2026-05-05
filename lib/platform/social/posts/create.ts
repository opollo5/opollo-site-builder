import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { CreatePostMasterInput, PostMaster } from "./types";

// ---------------------------------------------------------------------------
// S1-1 — create a social_post_master row.
//
// Pure data-write. The route handler that calls this is responsible for
// the canDo("create_post") check + resolving the company_id from the
// authenticated user's membership. This lib trusts the caller has done
// both — same convention as lib/platform/companies/create.ts.
//
// V1 scope: master_text + link_url + source_type only. Variants
// (social_post_variant rows per platform) and media attachments
// (social_media_assets) come in subsequent slices. New posts always
// land in state='draft' — the state machine takes over from there.
// ---------------------------------------------------------------------------

const MASTER_TEXT_MAX = 10_000;
const LINK_URL_MAX = 2048;

export async function createPostMaster(
  input: CreatePostMasterInput,
): Promise<ApiResponse<PostMaster>> {
  if (!input.companyId) {
    return validation("Company id is required.");
  }

  const masterText = normaliseText(input.masterText);
  if (masterText !== null && masterText.length > MASTER_TEXT_MAX) {
    return validation(
      `master_text must be ${MASTER_TEXT_MAX} characters or fewer.`,
    );
  }

  const linkUrl = normaliseText(input.linkUrl);
  if (linkUrl !== null) {
    if (linkUrl.length > LINK_URL_MAX) {
      return validation(`link_url must be ${LINK_URL_MAX} characters or fewer.`);
    }
    if (!isHttpUrl(linkUrl)) {
      return validation("link_url must be a valid http(s) URL.");
    }
  }

  // Reject the empty post — at least one of master_text or link_url
  // must be present. The schema allows both to be null, but a post with
  // neither is meaningless and will trip later validators (variant
  // generation, approval snapshots).
  if (masterText === null && linkUrl === null) {
    return validation(
      "A post must have at least master_text or link_url.",
    );
  }

  const sourceType = input.sourceType ?? "manual";

  const svc = getServiceRoleClient();
  const result = await svc
    .from("social_post_master")
    .insert({
      company_id: input.companyId,
      state: "draft",
      source_type: sourceType,
      master_text: masterText,
      link_url: linkUrl,
      created_by: input.createdBy,
    })
    .select(
      "id, company_id, state, source_type, master_text, link_url, created_by, created_at, updated_at, state_changed_at",
    )
    .single();

  if (result.error) {
    // 23503 = FK violation. The only FKs on this table are company_id
    // (→ platform_companies) and created_by (→ platform_users).
    if (result.error.code === "23503") {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message:
            "Company or creator does not exist. Check company_id and created_by.",
          retryable: false,
          suggested_action:
            "Verify the company exists and the user is a platform user.",
        },
        timestamp: new Date().toISOString(),
      };
    }
    logger.error("social.posts.create.failed", {
      err: result.error.message,
      code: result.error.code,
      company_id: input.companyId,
    });
    return internal(`Failed to create post: ${result.error.message}`);
  }

  return {
    ok: true,
    data: result.data as PostMaster,
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
