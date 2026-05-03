import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-21 — list publish attempts for a single post.
//
// Returns attempts joined back to their variant (for platform) and
// ordered by started_at desc — newest first so retries land at the
// top. Cross-company isolation: every attempt's
// publish_jobs.company_id must equal the caller's companyId; we filter
// in the inner queries (no embed because publish_attempts has multiple
// FKs that PostgREST can't disambiguate).
//
// V1 returns the raw attempt fields the UI needs; the component
// formats. No pagination — V1 caps at 50 attempts per post which
// is generous (5 retries × 10 platforms).
// ---------------------------------------------------------------------------

import type { SocialPlatform } from "@/lib/platform/social/variants/types";

export type PublishAttempt = {
  id: string;
  publish_job_id: string;
  post_variant_id: string;
  platform: SocialPlatform;
  status: string;
  bundle_post_id: string | null;
  platform_post_url: string | null;
  error_class: string | null;
  error_payload: Record<string, unknown> | null;
  retry_count: number;
  original_attempt_id: string | null;
  started_at: string;
  completed_at: string | null;
};

export type ListAttemptsInput = {
  postMasterId: string;
  companyId: string;
};

export async function listPublishAttempts(
  input: ListAttemptsInput,
): Promise<ApiResponse<{ attempts: PublishAttempt[] }>> {
  if (!input.postMasterId) return validation("postMasterId is required.");
  if (!input.companyId) return validation("companyId is required.");

  const svc = getServiceRoleClient();

  // Step 1: variants for the post (also gives us platform per variant).
  const variants = await svc
    .from("social_post_variant")
    .select("id, platform")
    .eq("post_master_id", input.postMasterId);
  if (variants.error) {
    logger.error("social.publish.list_attempts.variants_failed", {
      err: variants.error.message,
    });
    return internal(`Failed to read variants: ${variants.error.message}`);
  }
  if (!variants.data || variants.data.length === 0) {
    return {
      ok: true,
      data: { attempts: [] },
      timestamp: new Date().toISOString(),
    };
  }

  const variantIdToPlatform = new Map<string, string>();
  for (const v of variants.data) {
    variantIdToPlatform.set(v.id as string, v.platform as string);
  }
  const variantIds = Array.from(variantIdToPlatform.keys());

  // Step 2: attempts under those variants. We'd embed publish_jobs to
  // confirm company_id, but supabase-js multi-FK pitfall (memory note);
  // do the company check separately.
  const attempts = await svc
    .from("social_publish_attempts")
    .select(
      "id, publish_job_id, post_variant_id, status, bundle_post_id, platform_post_url, error_class, error_payload, retry_count, original_attempt_id, started_at, completed_at",
    )
    .in("post_variant_id", variantIds)
    .order("started_at", { ascending: false })
    .limit(50);
  if (attempts.error) {
    logger.error("social.publish.list_attempts.attempts_failed", {
      err: attempts.error.message,
    });
    return internal(`Failed to read attempts: ${attempts.error.message}`);
  }

  if (!attempts.data || attempts.data.length === 0) {
    return {
      ok: true,
      data: { attempts: [] },
      timestamp: new Date().toISOString(),
    };
  }

  // Step 3: confirm every attempt's job belongs to this company. One
  // batch read keyed off the unique job ids.
  const jobIds = Array.from(
    new Set(attempts.data.map((a) => a.publish_job_id as string)),
  );
  const jobs = await svc
    .from("social_publish_jobs")
    .select("id, company_id")
    .in("id", jobIds);
  if (jobs.error) {
    logger.error("social.publish.list_attempts.jobs_failed", {
      err: jobs.error.message,
    });
    return internal(`Failed to read jobs: ${jobs.error.message}`);
  }
  const jobToCompany = new Map<string, string>();
  for (const j of jobs.data ?? []) {
    jobToCompany.set(j.id as string, j.company_id as string);
  }

  const result: PublishAttempt[] = [];
  for (const a of attempts.data) {
    if (jobToCompany.get(a.publish_job_id as string) !== input.companyId) {
      continue;
    }
    const platformText =
      variantIdToPlatform.get(a.post_variant_id as string) ?? null;
    if (!platformText) continue;
    result.push({
      id: a.id as string,
      publish_job_id: a.publish_job_id as string,
      post_variant_id: a.post_variant_id as string,
      platform: platformText as SocialPlatform,
      status: a.status as string,
      bundle_post_id: (a.bundle_post_id as string | null) ?? null,
      platform_post_url: (a.platform_post_url as string | null) ?? null,
      error_class: (a.error_class as string | null) ?? null,
      error_payload:
        (a.error_payload as Record<string, unknown> | null) ?? null,
      retry_count: (a.retry_count as number | null) ?? 0,
      original_attempt_id: (a.original_attempt_id as string | null) ?? null,
      started_at: a.started_at as string,
      completed_at: (a.completed_at as string | null) ?? null,
    });
  }

  return {
    ok: true,
    data: { attempts: result },
    timestamp: new Date().toISOString(),
  };
}

function validation<T>(message: string): ApiResponse<T> {
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

function internal<T>(message: string): ApiResponse<T> {
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
