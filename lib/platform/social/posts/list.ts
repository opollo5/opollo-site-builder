import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ListPostMastersInput, PostMasterListItem } from "./types";

// ---------------------------------------------------------------------------
// S1-1 — list social_post_master rows scoped to one company.
//
// Caller (route handler / RSC page) is responsible for the canDo
// permission gate (view_calendar at minimum) and for resolving the
// caller's company_id. RLS enforces the company scope at the DB layer
// regardless, but the lib explicitly filters by company_id so opollo
// staff (who can read every company under RLS) get the same scoped
// view in this code path.
//
// Default ordering: most-recently changed first (state_changed_at DESC),
// which matches the calendar's "what moved today" mental model better
// than created_at.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listPostMasters(
  input: ListPostMastersInput,
): Promise<ApiResponse<{ posts: PostMasterListItem[] }>> {
  if (!input.companyId) {
    return validation("Company id is required.");
  }

  const limit = clamp(input.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = Math.max(0, input.offset ?? 0);

  const svc = getServiceRoleClient();
  let query = svc
    .from("social_post_master")
    .select(
      "id, state, source_type, master_text, link_url, created_by, created_at, updated_at, state_changed_at",
    )
    .eq("company_id", input.companyId)
    .order("state_changed_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (input.states && input.states.length > 0) {
    query = query.in("state", input.states);
  }

  const term = input.q?.trim();
  if (term) {
    query = query.ilike("master_text", `%${term}%`);
  }

  const result = await query;

  if (result.error) {
    logger.error("social.posts.list.failed", {
      err: result.error.message,
      company_id: input.companyId,
    });
    return internal(`Failed to list posts: ${result.error.message}`);
  }

  return {
    ok: true,
    data: { posts: (result.data ?? []) as PostMasterListItem[] },
    timestamp: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function validation(
  message: string,
): ApiResponse<{ posts: PostMasterListItem[] }> {
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

function internal(
  message: string,
): ApiResponse<{ posts: PostMasterListItem[] }> {
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
