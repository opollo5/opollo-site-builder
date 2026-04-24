// ---------------------------------------------------------------------------
// Shared request-builder helpers for app/api/tools/* route integration tests.
//
// Imported by tools-{route}-route.test.ts files. Does NOT import from
// _helpers.ts or _auth-helpers.ts (those require a Supabase client).
// ---------------------------------------------------------------------------

/**
 * Build a POST Request with a JSON body.  url defaults to a generic tools
 * path — individual test files may override with the real path if needed.
 */
export function makeJsonRequest(
  body: unknown,
  url = "http://localhost:3000/api/tools/test",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Build a POST Request whose body is NOT valid JSON.  The route's try/catch
 * around req.json() should fall back to `{}` and forward that to the executor.
 */
export function makeMalformedRequest(
  url = "http://localhost:3000/api/tools/test",
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "not json at all",
  });
}

/**
 * A minimal RateLimitResult that looks "denied".  Shape mirrors the
 * Extract<RateLimitResult, { ok: false }> union arm from lib/rate-limit.ts.
 */
export const RATE_LIMIT_DENIED = {
  ok: false as const,
  limit: 120,
  remaining: 0 as const,
  reset: Date.now() + 60_000,
  retryAfterSec: 30,
};

/**
 * A minimal RateLimitResult that looks "allowed".
 */
export const RATE_LIMIT_ALLOWED = {
  ok: true as const,
  limit: 120,
  remaining: 119,
  reset: 0,
};

/** Minimal success envelope shape reused across test fixtures. */
export function makeSuccessEnvelope<T>(data: T) {
  return {
    ok: true as const,
    data,
    validation: { passed: true as const, checks: [] as string[] },
    ds_version: "1.0.0",
    timestamp: "2026-04-24T00:00:00.000Z",
  };
}

/** Minimal error envelope for VALIDATION_FAILED (→ 400). */
export function makeValidationErrorEnvelope(message = "bad input") {
  return {
    ok: false as const,
    error: {
      code: "VALIDATION_FAILED" as const,
      message,
      retryable: false,
      suggested_action: "Fix the input and retry.",
    },
    timestamp: "2026-04-24T00:00:00.000Z",
  };
}
