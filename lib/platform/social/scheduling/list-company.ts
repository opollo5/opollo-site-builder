import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-25 — list schedule entries for a whole company in a date window.
//
// Powers the calendar view at /company/social/calendar. Joins
// schedule_entries → variants → post_master so we can render
//   "12 May 09:00 — LinkedIn — 'Hello world…'"
// without N round trips per row.
//
// Multi-FK embed avoidance (memory note): we go in two reads:
//   1. variants WHERE post_master_id IN (company's posts) → variant
//      ids + platform + master snippet. We pull master.id +
//      master_text via a single embed since variant has only one FK
//      to master. Cheap.
//   2. schedule_entries WHERE post_variant_id IN (variant ids) AND
//      scheduled_at BETWEEN from AND to.
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
  includeCancelled?: boolean;
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

  // Step 1: company's posts.
  const posts = await svc
    .from("social_post_master")
    .select("id, master_text")
    .eq("company_id", input.companyId);
  if (posts.error) {
    logger.error("social.scheduling.list_company.posts_failed", {
      err: posts.error.message,
    });
    return internal(`Failed to read posts: ${posts.error.message}`);
  }
  if (!posts.data || posts.data.length === 0) {
    return {
      ok: true,
      data: { entries: [] },
      timestamp: new Date().toISOString(),
    };
  }
  const postIds = posts.data.map((p) => p.id as string);
  const postTextById = new Map<string, string | null>();
  for (const p of posts.data) {
    postTextById.set(p.id as string, (p.master_text as string | null) ?? null);
  }

  // Step 2: variants for those posts.
  const variants = await svc
    .from("social_post_variant")
    .select("id, post_master_id, platform, variant_text, is_custom")
    .in("post_master_id", postIds);
  if (variants.error) {
    logger.error("social.scheduling.list_company.variants_failed", {
      err: variants.error.message,
    });
    return internal(`Failed to read variants: ${variants.error.message}`);
  }
  if (!variants.data || variants.data.length === 0) {
    return {
      ok: true,
      data: { entries: [] },
      timestamp: new Date().toISOString(),
    };
  }
  type VariantRow = {
    id: string;
    post_master_id: string;
    platform: SocialPlatform;
    variant_text: string | null;
    is_custom: boolean;
  };
  const variantById = new Map<string, VariantRow>();
  for (const v of variants.data) {
    variantById.set(v.id as string, {
      id: v.id as string,
      post_master_id: v.post_master_id as string,
      platform: v.platform as SocialPlatform,
      variant_text: (v.variant_text as string | null) ?? null,
      is_custom: Boolean(v.is_custom),
    });
  }
  const variantIds = Array.from(variantById.keys());

  // Step 3: schedule_entries in window.
  let query = svc
    .from("social_schedule_entries")
    .select("id, post_variant_id, scheduled_at, cancelled_at")
    .in("post_variant_id", variantIds)
    .gte("scheduled_at", input.fromIso)
    .lte("scheduled_at", input.toIso)
    .order("scheduled_at", { ascending: true });
  if (!input.includeCancelled) {
    query = query.is("cancelled_at", null);
  }
  const entries = await query;
  if (entries.error) {
    logger.error("social.scheduling.list_company.entries_failed", {
      err: entries.error.message,
    });
    return internal(`Failed to read entries: ${entries.error.message}`);
  }

  const decorated: CompanyScheduleEntry[] = (entries.data ?? []).map((e) => {
    const variant = variantById.get(e.post_variant_id as string)!;
    const text = variant.is_custom
      ? variant.variant_text
      : postTextById.get(variant.post_master_id) ?? variant.variant_text;
    const trimmed = (text ?? "").trim();
    const preview =
      trimmed.length === 0
        ? null
        : trimmed.length <= PREVIEW_CHAR_LIMIT
          ? trimmed
          : `${trimmed.slice(0, PREVIEW_CHAR_LIMIT)}…`;
    return {
      id: e.id as string,
      post_variant_id: variant.id,
      post_master_id: variant.post_master_id,
      platform: variant.platform,
      scheduled_at: e.scheduled_at as string,
      cancelled_at: (e.cancelled_at as string | null) ?? null,
      preview,
    };
  });

  return {
    ok: true,
    data: { entries: decorated },
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
