import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Rate-limit state management for social publishing.
//
// social_rate_limits tracks per-(connection, 24h-window) state.
// The window starts at midnight UTC. On each successful publish call the
// request counter is incremented; on a 429 response the last_429_at
// timestamp is stamped.
//
// recordPublishRequest is best-effort: a read → write race under high
// concurrency may undercount, but the table is informational only —
// publish.fire uses it for retry back-off, not hard blocking.
// ---------------------------------------------------------------------------

function windowStartsAt(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function windowResetsAt(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export type RateLimitWindow = {
  id: string;
  connection_id: string;
  platform: string;
  window_starts_at: string;
  window_resets_at: string;
  requests_made: number;
  requests_limit: number;
  last_429_at: string | null;
};

/**
 * Read the current 24h rate-limit window for a connection.
 * Returns null if no requests have been recorded today.
 */
export async function getRateLimitWindow(
  connectionId: string,
): Promise<RateLimitWindow | null> {
  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("social_rate_limits")
    .select()
    .eq("connection_id", connectionId)
    .eq("window_starts_at", windowStartsAt())
    .maybeSingle();
  return (data as RateLimitWindow | null) ?? null;
}

/**
 * Record a successful publish request for a connection.
 * Creates the window row on first use; increments requests_made thereafter.
 *
 * @param platform  e.g. "linkedin_personal", "x"
 * @param limit     platform-specific daily cap (default 100)
 */
export async function recordPublishRequest(
  connectionId: string,
  platform: string,
  limit = 100,
): Promise<void> {
  const svc = getServiceRoleClient();
  const starts = windowStartsAt();
  const resets = windowResetsAt();
  const now = new Date().toISOString();

  const existing = await getRateLimitWindow(connectionId);

  if (existing) {
    const { error } = await svc
      .from("social_rate_limits")
      .update({ requests_made: existing.requests_made + 1, updated_at: now })
      .eq("connection_id", connectionId)
      .eq("window_starts_at", starts);
    if (error) {
      logger.warn("social.rate_limits.increment_failed", {
        connection_id: connectionId,
        err: error.message,
      });
    }
  } else {
    const { error } = await svc.from("social_rate_limits").insert({
      connection_id: connectionId,
      platform,
      window_starts_at: starts,
      window_resets_at: resets,
      requests_made: 1,
      requests_limit: limit,
    });
    if (error && error.code !== "23505") {
      // 23505 = race: another worker inserted first — harmless
      logger.warn("social.rate_limits.insert_failed", {
        connection_id: connectionId,
        err: error.message,
      });
    }
  }
}

/**
 * Record a 429 rate-limit response for a connection.
 */
export async function record429(connectionId: string): Promise<void> {
  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  const { error } = await svc
    .from("social_rate_limits")
    .update({ last_429_at: now, updated_at: now })
    .eq("connection_id", connectionId)
    .eq("window_starts_at", windowStartsAt());

  if (error) {
    logger.warn("social.rate_limits.record_429_failed", {
      connection_id: connectionId,
      err: error.message,
    });
  }
}
