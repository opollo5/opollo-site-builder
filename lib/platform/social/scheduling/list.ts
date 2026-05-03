import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  ListScheduleEntriesInput,
  ScheduleEntryWithPlatform,
} from "./types";

// ---------------------------------------------------------------------------
// S1-14 — list schedule entries for a post.
//
// Joins social_schedule_entries → social_post_variant to surface the
// variant's platform alongside the entry. Two queries (lookup variants
// for the post first, then entries) avoids the multi-FK embed gotcha
// from memory feedback_postgrest_embed_ambiguous_fk.md.
//
// Caller is responsible for canDo("view_calendar", company_id).
// ---------------------------------------------------------------------------

export async function listScheduleEntries(
  input: ListScheduleEntriesInput,
): Promise<ApiResponse<{ entries: ScheduleEntryWithPlatform[] }>> {
  if (!input.postMasterId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");

  const svc = getServiceRoleClient();

  // Verify post belongs to this company; saves a leak across companies
  // even though the entries themselves don't carry company_id.
  const post = await svc
    .from("social_post_master")
    .select("id")
    .eq("id", input.postMasterId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (post.error) {
    logger.error("social.scheduling.list.post_lookup_failed", {
      err: post.error.message,
    });
    return internal(`Failed to read post: ${post.error.message}`);
  }
  if (!post.data) return notFound();

  // Resolve variant ids + their platforms for this post.
  const variants = await svc
    .from("social_post_variant")
    .select("id, platform")
    .eq("post_master_id", input.postMasterId);
  if (variants.error) {
    logger.error("social.scheduling.list.variants_failed", {
      err: variants.error.message,
    });
    return internal(`Failed to list variants: ${variants.error.message}`);
  }

  const variantIds = (variants.data ?? []).map((v) => v.id as string);
  if (variantIds.length === 0) {
    return {
      ok: true,
      data: { entries: [] },
      timestamp: new Date().toISOString(),
    };
  }

  let query = svc
    .from("social_schedule_entries")
    .select(
      "id, post_variant_id, scheduled_at, qstash_message_id, scheduled_by, cancelled_at, created_at",
    )
    .in("post_variant_id", variantIds)
    .order("scheduled_at", { ascending: true });

  if (!input.includeCancelled) {
    query = query.is("cancelled_at", null);
  }

  const entries = await query;
  if (entries.error) {
    logger.error("social.scheduling.list.entries_failed", {
      err: entries.error.message,
    });
    return internal(`Failed to list entries: ${entries.error.message}`);
  }

  // Build a variant_id → platform lookup so we can decorate each entry.
  const platformByVariant = new Map<string, ScheduleEntryWithPlatform["platform"]>();
  for (const v of variants.data ?? []) {
    platformByVariant.set(
      v.id as string,
      v.platform as ScheduleEntryWithPlatform["platform"],
    );
  }

  const decorated: ScheduleEntryWithPlatform[] = (entries.data ?? []).map(
    (e) => ({
      ...(e as Omit<ScheduleEntryWithPlatform, "platform">),
      platform:
        platformByVariant.get(e.post_variant_id as string) ?? "linkedin_personal",
    }),
  );

  return {
    ok: true,
    data: { entries: decorated },
    timestamp: new Date().toISOString(),
  };
}

function validation(
  message: string,
): ApiResponse<{ entries: ScheduleEntryWithPlatform[] }> {
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

function notFound(): ApiResponse<{ entries: ScheduleEntryWithPlatform[] }> {
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

function internal(
  message: string,
): ApiResponse<{ entries: ScheduleEntryWithPlatform[] }> {
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
