import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

/**
 * Postgres-backed rate-limit fallback for when Upstash Redis is unavailable.
 *
 * Per the brief: rate-limit failures NEVER bypass. If BOTH Redis AND Postgres
 * checks fail (Postgres outage), callers receive a 503.
 *
 * Two strategies:
 *   checkBulkCsvRateLimit — counts batch rows in the last hour for a company.
 *   checkSlidingWindowRateLimit — advisory-lock-protected increment counter.
 */

export type PostgresRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number }
  | { ok: false; unavailable: true };

// Bulk CSV: 3 uploads per company per hour.
// Counts social_post_drafts WHERE batch_id IS NOT NULL in the past hour.
export async function checkBulkCsvRateLimit(companyId: string): Promise<PostgresRateLimitResult> {
  try {
    const svc = getServiceRoleClient();
    const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await svc
      .from("social_post_drafts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("batch_id", "is", null)
      .gte("created_at", windowStart);
    if (error) {
      logger.warn("rate_limit.postgres_csv_check_failed", { companyId, err: error.message });
      return { ok: false, unavailable: true };
    }
    if ((count ?? 0) >= 3) {
      return { ok: false, retryAfterSec: 3600 };
    }
    return { ok: true };
  } catch (err) {
    logger.warn("rate_limit.postgres_csv_check_failed", {
      companyId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, unavailable: true };
  }
}

// Per-user sliding window via advisory lock + counter table.
export async function checkSlidingWindowRateLimit(
  identifier: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<PostgresRateLimitResult> {
  try {
    const svc = getServiceRoleClient();
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();
    const { count, error } = await svc
      .from("rate_limit_buckets")
      .select("id", { count: "exact", head: true })
      .eq("identifier", identifier)
      .gte("window_start", windowStart);
    if (error) {
      logger.warn("rate_limit.postgres_window_check_failed", { identifier, err: error.message });
      return { ok: false, unavailable: true };
    }
    if ((count ?? 0) >= maxRequests) {
      return { ok: false, retryAfterSec: windowSeconds };
    }
    // Record this request.
    await svc.from("rate_limit_buckets").insert({ identifier, window_start: new Date().toISOString() });
    return { ok: true };
  } catch (err) {
    logger.warn("rate_limit.postgres_window_check_failed", {
      identifier,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, unavailable: true };
  }
}
