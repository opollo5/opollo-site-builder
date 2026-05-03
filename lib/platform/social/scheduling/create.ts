import "server-only";

import { logger } from "@/lib/logger";
import { enqueueScheduledPublish } from "@/lib/platform/social/publishing";
import { SUPPORTED_PLATFORMS } from "@/lib/platform/social/variants/types";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type {
  CreateScheduleEntryInput,
  ScheduleEntryWithPlatform,
} from "./types";

// ---------------------------------------------------------------------------
// S1-14 — schedule a single (post, platform, datetime) tuple.
//
// Steps:
//   1. Verify post is in 'approved' state for this company.
//   2. Verify scheduled_at is in the future.
//   3. Ensure a social_post_variant row exists for (post, platform).
//      We can't reuse upsertVariant because that lib gates on
//      state='draft'; an approved post needs a different path. We
//      just insert with is_custom=false (variant_text=null) so the
//      publish layer falls back to master_text.
//   4. Verify no non-cancelled schedule entry already exists for the
//      variant (prevents accidental double-publish).
//   5. INSERT the schedule entry.
//
// QStash enqueue is intentionally NOT done here. The publish-handler
// route lands in S1-15+ when bundle.social wiring is ready; until
// then a backfill cron will pick up entries lacking qstash_message_id.
//
// Caller is responsible for canDo("schedule_post", company_id).
// ---------------------------------------------------------------------------

export async function createScheduleEntry(
  input: CreateScheduleEntryInput,
): Promise<ApiResponse<ScheduleEntryWithPlatform>> {
  if (!input.postMasterId) return validation("Post id is required.");
  if (!input.companyId) return validation("Company id is required.");
  if (!SUPPORTED_PLATFORMS.includes(input.platform)) {
    return validation(`Unsupported platform: ${input.platform}.`);
  }

  const scheduledAtMs = Date.parse(input.scheduledAt);
  if (Number.isNaN(scheduledAtMs)) {
    return validation("scheduled_at must be a valid ISO timestamp.");
  }
  if (scheduledAtMs <= Date.now()) {
    return validation("scheduled_at must be in the future.");
  }

  const svc = getServiceRoleClient();

  // 1. Parent post must exist + be approved.
  const post = await svc
    .from("social_post_master")
    .select("id, state")
    .eq("id", input.postMasterId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (post.error) {
    logger.error("social.scheduling.create.post_lookup_failed", {
      err: post.error.message,
      post_id: input.postMasterId,
    });
    return internal(`Failed to read post: ${post.error.message}`);
  }
  if (!post.data) return notFound();

  if (post.data.state !== "approved") {
    return invalidState(
      `Post is in '${post.data.state}', not 'approved'. Only approved posts can be scheduled.`,
    );
  }

  // 2. Ensure the variant row exists. Use upsert with onConflict so
  // concurrent schedule attempts on the same (post, platform) converge
  // to one row.
  const variantUpsert = await svc
    .from("social_post_variant")
    .upsert(
      {
        post_master_id: input.postMasterId,
        platform: input.platform,
        // Don't touch variant_text or is_custom on conflict — preserve
        // any operator-authored override.
      },
      {
        onConflict: "post_master_id,platform",
        ignoreDuplicates: true,
      },
    )
    .select("id")
    .maybeSingle();
  if (variantUpsert.error) {
    logger.error("social.scheduling.create.variant_upsert_failed", {
      err: variantUpsert.error.message,
      post_id: input.postMasterId,
      platform: input.platform,
    });
    return internal(
      `Failed to ensure variant row: ${variantUpsert.error.message}`,
    );
  }

  // ignoreDuplicates returns no row on conflict; need a second read
  // to get the variant id either way.
  let variantId: string | null = (variantUpsert.data?.id as string) ?? null;
  if (!variantId) {
    const variantRead = await svc
      .from("social_post_variant")
      .select("id")
      .eq("post_master_id", input.postMasterId)
      .eq("platform", input.platform)
      .maybeSingle();
    if (variantRead.error || !variantRead.data) {
      return internal(
        `Variant row missing after upsert: ${variantRead.error?.message ?? "no row"}`,
      );
    }
    variantId = variantRead.data.id as string;
  }

  // 3. Reject if a non-cancelled schedule already exists.
  const existing = await svc
    .from("social_schedule_entries")
    .select("id, scheduled_at")
    .eq("post_variant_id", variantId)
    .is("cancelled_at", null)
    .maybeSingle();
  if (existing.error) {
    logger.error("social.scheduling.create.dup_check_failed", {
      err: existing.error.message,
    });
    return internal(`Failed dup check: ${existing.error.message}`);
  }
  if (existing.data) {
    return invalidState(
      `An active schedule entry already exists for this platform (scheduled at ${existing.data.scheduled_at}). Cancel it first if you want to reschedule.`,
    );
  }

  // 4. Insert.
  const insert = await svc
    .from("social_schedule_entries")
    .insert({
      post_variant_id: variantId,
      scheduled_at: input.scheduledAt,
      scheduled_by: input.scheduledBy,
    })
    .select(
      "id, post_variant_id, scheduled_at, qstash_message_id, scheduled_by, cancelled_at, created_at",
    )
    .single();
  if (insert.error) {
    logger.error("social.scheduling.create.insert_failed", {
      err: insert.error.message,
      code: insert.error.code,
    });
    return internal(`Failed to create schedule entry: ${insert.error.message}`);
  }

  const entry = insert.data as ScheduleEntryWithPlatform;

  // S1-18 — enqueue the QStash callback. Best-effort: enqueue failure
  // does NOT roll back the schedule entry. The row remains and can be
  // re-enqueued by a backfill cron (future slice). Skipped silently when
  // the caller didn't pass an origin (e.g. lib-only test paths).
  if (input.origin) {
    const enqueue = await enqueueScheduledPublish({
      scheduleEntryId: entry.id,
      scheduledAt: input.scheduledAt,
      origin: input.origin,
    });
    if (!enqueue.ok) {
      logger.warn("social.scheduling.create.enqueue_failed", {
        err: enqueue.error.message,
        schedule_entry_id: entry.id,
      });
      // Update the in-memory row with the message id we tried to set
      // (still null) — the DB row was already updated by the lib.
    } else if (enqueue.data.messageId) {
      // enqueue lib already wrote the messageId back to the row; reflect
      // it in the response without a re-read.
      (entry as { qstash_message_id: string | null }).qstash_message_id =
        enqueue.data.messageId;
    }
  }

  return {
    ok: true,
    data: {
      ...entry,
      platform: input.platform,
    },
    timestamp: new Date().toISOString(),
  };
}

function validation(message: string): ApiResponse<ScheduleEntryWithPlatform> {
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

function notFound(): ApiResponse<ScheduleEntryWithPlatform> {
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

function invalidState(message: string): ApiResponse<ScheduleEntryWithPlatform> {
  return {
    ok: false,
    error: {
      code: "INVALID_STATE",
      message,
      retryable: false,
      suggested_action:
        "Reload the page; the post or schedule may have moved.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<ScheduleEntryWithPlatform> {
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
