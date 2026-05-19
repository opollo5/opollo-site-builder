import "server-only";

import { checkRateLimit, type LimiterName } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Upstash primary implementation for the two-layer rate-limit module.
//
// Thin wrapper around the existing lib/rate-limit checkRateLimit which
// already uses Upstash as its backend. Maps the result to the platform
// PlatformRateLimitResult type so the index.ts combiner can reason about
// both layers with a single type.
//
// When Upstash is not configured (no UPSTASH_REDIS_REST_URL / TOKEN) the
// underlying checkRateLimit returns ok:true (fail-open for the Upstash
// layer only). The two-layer combiner in index.ts falls through to Postgres
// in that case — so the overall check still enforces a limit.
// ---------------------------------------------------------------------------

export type PlatformRateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSec: number }
  | { ok: false; unavailable: true };

export async function checkUpstashRateLimit(
  name: LimiterName,
  identifier: string,
): Promise<PlatformRateLimitResult> {
  try {
    const result = await checkRateLimit(name, identifier);
    if (result.ok) return { ok: true };
    return { ok: false, retryAfterSec: result.retryAfterSec };
  } catch (err) {
    logger.warn("rate_limit.upstash_check_failed", {
      name,
      identifier,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, unavailable: true };
  }
}
