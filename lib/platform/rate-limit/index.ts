import "server-only";

import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import type { LimiterName } from "@/lib/rate-limit";
import { checkUpstashRateLimit, type PlatformRateLimitResult } from "./upstash-rate-limit";
import { checkSlidingWindowRateLimit } from "./postgres-rate-limit";

// ---------------------------------------------------------------------------
// lib/platform/rate-limit — unified two-layer rate-limit check.
//
// Layer 1: Upstash Redis (fast, globally distributed). Wraps the existing
//   lib/rate-limit checkRateLimit. Fail-open at the Upstash level only.
// Layer 2: Postgres sliding window (slower, always available if DB is up).
//   Acts as the enforcing fallback when Upstash is not configured or fails.
//
// Semantics:
//   - Upstash ok → allow (Postgres check skipped for speed)
//   - Upstash rate-limited → deny (Postgres check skipped)
//   - Upstash unavailable → check Postgres
//   - Postgres ok → allow
//   - Postgres rate-limited → deny
//   - Postgres unavailable → deny with 503 (NEVER silently allow)
//
// This is the fail-closed posture specified in API_CONTRACTS.md §10:
// rate-limit failures must never bypass.
// ---------------------------------------------------------------------------

export type { PlatformRateLimitResult };

/**
 * Check rate limit via Upstash (primary) then Postgres (fallback).
 * Returns a structured result; callers use platformRateLimitExceeded()
 * or platformRateLimitUnavailable() to build the response.
 */
export async function checkPlatformRateLimit(
  name: LimiterName,
  identifier: string,
): Promise<PlatformRateLimitResult> {
  const upstash = await checkUpstashRateLimit(name, identifier);

  if (upstash.ok) return { ok: true };

  if ("retryAfterSec" in upstash) {
    // Upstash confirmed rate-limited — respect it without hitting Postgres.
    return upstash;
  }

  // Upstash unavailable — fall through to Postgres.
  logger.info("rate_limit.falling_back_to_postgres", { name, identifier });

  const cfg = LIMITER_TO_POSTGRES_CONFIG[name];
  if (!cfg) {
    // No Postgres equivalent for this limiter name. Fail closed.
    logger.warn("rate_limit.no_postgres_fallback", { name, identifier });
    return { ok: false, unavailable: true };
  }

  return await checkSlidingWindowRateLimit(identifier, cfg.maxRequests, cfg.windowSeconds);
}

/**
 * Build a 429 response. Use when checkPlatformRateLimit returns
 * { ok: false, retryAfterSec }.
 */
export function platformRateLimitExceeded(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMITED",
        message: `Too many requests. Try again in ${retryAfterSec} seconds.`,
        retryable: true,
        suggested_action: "Wait for the retry-after window and retry the request.",
      },
      timestamp: new Date().toISOString(),
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}

/**
 * Build a 503 response. Use when checkPlatformRateLimit returns
 * { ok: false, unavailable: true } — both layers failed.
 */
export function platformRateLimitUnavailable(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "Rate limiting service unavailable. Please try again shortly.",
        retryable: true,
        suggested_action: "Retry after a short delay.",
      },
      timestamp: new Date().toISOString(),
    },
    { status: 503 },
  );
}

// Maps each LimiterName to Postgres sliding-window parameters.
// Only limiters that have a Postgres fallback entry participate in
// fail-closed enforcement; others get a 503 when Upstash is down.
const LIMITER_TO_POSTGRES_CONFIG: Partial<
  Record<LimiterName, { maxRequests: number; windowSeconds: number }>
> = {
  // POST /drafts — 120 requests / 60 s per user (matches Upstash config)
  chat:              { maxRequests: 120, windowSeconds: 60 },
  // POST /drafts/bulk CSV — 3 uploads / hour per company
  csv_upload:        { maxRequests: 3,   windowSeconds: 3600 },
  // GET /drafts/[id]/analytics — reuses chat limits
  // POST /drafts/[id]/approve — 20 / hour per IP
  approval_decision: { maxRequests: 20,  windowSeconds: 3600 },
  // CAP AI endpoints
  cap_generate:      { maxRequests: 10,  windowSeconds: 86400 },
  cap_assist:        { maxRequests: 30,  windowSeconds: 3600 },
};
