import { Ratelimit } from "@upstash/ratelimit";
import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";

// ---------------------------------------------------------------------------
// M10 follow-up / security audit §1 Finding 3 + 4 — rate limiting.
//
// Named per-limiter buckets over the existing Upstash Redis client.
// Explicit opt-in per route (no middleware magic): callers import
// `checkRateLimit` + the limiter name, then `rateLimitExceeded` to
// shape the 429.
//
// Fail-open semantics:
//   - If Upstash isn't configured (getRedisClient() returns null),
//     every call passes. First miss per process logs at debug; after
//     that, silent. This is the test-and-local-dev path — the rate
//     limiter is transparent when disabled.
//   - If the limiter call THROWS (network blip, Upstash returns 5xx),
//     the call passes with a logger.warn. Upstash unavailability must
//     not DoS the product.
//
// Identifier convention (callers must supply):
//   - "user:<uuid>" for authenticated limiters
//   - "ip:<address>" for unauthenticated limiters (login, callback)
// ---------------------------------------------------------------------------

export type LimiterName =
  | "chat"
  | "batch"
  | "regen"
  | "tools"
  | "login"
  | "auth_callback"
  | "invite"
  | "register";

type LimiterConfig = {
  requests: number;
  window: `${number} ${"s" | "m" | "h"}`;
};

const CONFIGS: Record<LimiterName, LimiterConfig> = {
  chat:          { requests: 120, window: "60 s" },
  batch:         { requests: 30,  window: "60 s" },
  regen:         { requests: 60,  window: "60 s" },
  tools:         { requests: 120, window: "60 s" },
  login:         { requests: 10,  window: "60 s" },
  auth_callback: { requests: 10,  window: "60 s" },
  invite:        { requests: 20,  window: "1 h" },
  register:      { requests: 20,  window: "1 h" },
};

export type RateLimitResult =
  | { ok: true; limit: number; remaining: number; reset: number }
  | {
      ok: false;
      limit: number;
      remaining: 0;
      reset: number;
      retryAfterSec: number;
    };

const instances: Partial<Record<LimiterName, Ratelimit | null>> = {};
let warnedMissingRedisOnce = false;

function getLimiter(name: LimiterName): Ratelimit | null {
  const cached = instances[name];
  if (cached !== undefined) return cached;

  const redis = getRedisClient();
  if (!redis) {
    if (!warnedMissingRedisOnce) {
      warnedMissingRedisOnce = true;
      logger.debug(
        "rate-limit: Upstash not configured (UPSTASH_REDIS_REST_URL / TOKEN unset); rate limiting disabled (fail-open)",
      );
    }
    instances[name] = null;
    return null;
  }

  const cfg = CONFIGS[name];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.requests, cfg.window),
    prefix: `rl:${name}`,
    analytics: true,
  });
  instances[name] = limiter;
  return limiter;
}

/**
 * Check whether `identifier` may make another request under the named
 * limiter. Returns a structured result the caller uses to either proceed
 * or build a 429 via `rateLimitExceeded`.
 *
 * Fail-open: an unavailable limiter (no Upstash env, or a network
 * error) always returns { ok: true }. Never throws.
 */
export async function checkRateLimit(
  name: LimiterName,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = getLimiter(name);
  const cfg = CONFIGS[name];

  if (!limiter) {
    return { ok: true, limit: cfg.requests, remaining: cfg.requests, reset: 0 };
  }

  try {
    const result = await limiter.limit(identifier);
    if (result.success) {
      return {
        ok: true,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      };
    }
    const retryAfterSec = Math.max(
      1,
      Math.ceil((result.reset - Date.now()) / 1000),
    );
    return {
      ok: false,
      limit: result.limit,
      remaining: 0,
      reset: result.reset,
      retryAfterSec,
    };
  } catch (err) {
    logger.warn("rate-limit: Upstash call failed; allowing request", {
      limiter: name,
      identifier,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: true, limit: cfg.requests, remaining: cfg.requests, reset: 0 };
  }
}

/**
 * Build a 429 NextResponse from a failed rate-limit result. Shape
 * matches every other error envelope in the app (ok:false, error:{...},
 * timestamp) plus Retry-After / X-RateLimit-* headers per RFC 6585.
 */
export function rateLimitExceeded(
  result: Extract<RateLimitResult, { ok: false }>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${result.retryAfterSec} seconds.`,
        retryable: true,
        suggested_action:
          "Wait for the retry-after window and retry the request.",
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Reset": String(result.reset),
      },
    },
  );
}

/**
 * Read the caller's IP from request headers. On Vercel's edge + node
 * runtimes, `x-forwarded-for` is populated from the real client IP and
 * any client-supplied value is stripped at the edge, so the first
 * comma-separated entry is trustworthy. Falls back to `x-real-ip`, then
 * to "unknown" (shared bucket — a minor fail-open cost outside Vercel).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri;
  return "unknown";
}

/**
 * Test-only helper — clears the cached limiter instances + the
 * debug-log-once latch so env-var mutations in tests re-evaluate.
 */
export function __resetRateLimitForTests(): void {
  for (const key of Object.keys(instances) as LimiterName[]) {
    delete instances[key];
  }
  warnedMissingRedisOnce = false;
}
