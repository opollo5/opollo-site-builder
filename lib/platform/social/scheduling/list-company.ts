import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-25 — list schedule entries for a whole company in a date window.
//
// V2: reads social_post_drafts in state='scheduled'|'publishing' with
// scheduled_at in [fromIso, toIso]. Returns one entry per target_profile
// (or one entry with platform='unknown' if target_profiles is empty).
//
// includeCancelled is accepted for API compat but is a no-op: cancelled
// V2 drafts revert to state='pending_approval' with scheduled_at=null
// and do not appear in the window query.
// ---------------------------------------------------------------------------

const PREVIEW_CHAR_LIMIT = 80;

export type CompanyScheduleEntry = {
  id: string;
  post_variant_id: string;
  post_master_id: string;
  platform: SocialPlatform;
  scheduled_at: string;
  cancelled_at: string | null;
  preview: string | null;
};

export type ListCompanyEntriesInput = {
  companyId: string;
  fromIso: string; // inclusive lower bound
  toIso: string; // inclusive upper bound
  includeCancelled?: boolean; // V2 no-op — see header comment
};

export async function listCompanyScheduleEntries(
  input: ListCompanyEntriesInput,
): Promise<ApiResponse<{ entries: CompanyScheduleEntry[] }>> {
  if (!input.companyId) return validation("companyId required.");
  if (!input.fromIso || !input.toIso) {
    return validation("fromIso + toIso required.");
  }
  if (Number.isNaN(Date.parse(input.fromIso))) {
    return validation("fromIso must be a valid ISO timestamp.");
  }
  if (Number.isNaN(Date.parse(input.toIso))) {
    return validation("toIso must be a valid ISO timestamp.");
  }
  if (Date.parse(input.fromIso) > Date.parse(input.toIso)) {
    return validation("fromIso must be <= toIso.");
  }

  const svc = getServiceRoleClient();

  const v2drafts = await svc
    .from("social_post_drafts")
    .select("id, content, scheduled_at, target_profiles")
    .eq("company_id", input.companyId)
    .in("state", ["scheduled", "publishing"])
    .gte("scheduled_at", input.fromIso)
    .lte("scheduled_at", input.toIso)
    .order("scheduled_at", { ascending: true });

  if (v2drafts.error) {
    logger.error("social.scheduling.list_company.drafts_failed", {
      err: v2drafts.error.message,
    });
    return internal(`Failed to read drafts: ${v2drafts.error.message}`);
  }

  const entries: CompanyScheduleEntry[] = [];

  for (const d of v2drafts.data ?? []) {
    const draftId = d.id as string;
    const scheduledAt = d.scheduled_at as string;
    const text = (d.content as string | null) ?? "";
    const trimmed = text.trim();
    const preview =
      trimmed.length === 0
        ? null
        : trimmed.length <= PREVIEW_CHAR_LIMIT
          ? trimmed
          : `${trimmed.slice(0, PREVIEW_CHAR_LIMIT)}…`;
    const profiles =
      (d.target_profiles as Array<{
        profile_id: string;
        platform: string;
      }> | null) ?? [];

    if (profiles.length === 0) {
      entries.push({
        id: draftId,
        post_variant_id: draftId,
        post_master_id: draftId,
        platform: "unknown" as SocialPlatform,
        scheduled_at: scheduledAt,
        cancelled_at: null,
        preview,
      });
    } else {
      for (const p of profiles) {
        entries.push({
          id: `${draftId}:${p.profile_id}`,
          post_variant_id: draftId,
          post_master_id: draftId,
          platform: p.platform as SocialPlatform,
          scheduled_at: scheduledAt,
          cancelled_at: null,
          preview,
        });
      }
    }
  }

  return {
    ok: true,
    data: { entries },
    timestamp: new Date().toISOString(),
  };
}

function validation(
  message: string,
): ApiResponse<{ entries: CompanyScheduleEntry[] }> {
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
): ApiResponse<{ entries: CompanyScheduleEntry[] }> {
  logger.error("social.scheduling.list_company.internal_error", { message });
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
