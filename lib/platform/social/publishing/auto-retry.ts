import "server-only";

// ---------------------------------------------------------------------------
// Auto-retry scheduling for failed social publish attempts.
//
// Retryable error classes get a next_retry_at based on the exponential
// backoff schedule. Non-retryable errors and attempts that have exceeded
// max_retries are immediately dead-lettered.
//
// Backoff schedule (seconds): [0, 30, 300, 1800, 7200, 43200]
// Index = current retry_count on the failing attempt.
// ---------------------------------------------------------------------------

export const BACKOFF_SECONDS = [0, 30, 300, 1800, 7200, 43200] as const;

const RETRYABLE_CLASSES = new Set([
  "rate_limit",
  "network",
  "platform_error",
  "unknown",
  "worker_died",
]);

export type RetryUpdate = {
  next_retry_at: string | null;
  dead_lettered_at: string | null;
};

/**
 * Compute next_retry_at or dead_lettered_at for a failing attempt.
 *
 * @param retryCount   current retry_count on the attempt (0 = first failure)
 * @param maxRetries   max_retries on the attempt (default 5 from schema)
 * @param errorClass   classified error type from classifyError()
 */
export function computeRetryUpdate(
  retryCount: number,
  maxRetries: number,
  errorClass: string,
): RetryUpdate {
  const now = Date.now();

  if (!RETRYABLE_CLASSES.has(errorClass) || retryCount >= maxRetries) {
    return { next_retry_at: null, dead_lettered_at: new Date(now).toISOString() };
  }

  const backoffMs = (BACKOFF_SECONDS[retryCount] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]) * 1000;
  return {
    next_retry_at: new Date(now + backoffMs).toISOString(),
    dead_lettered_at: null,
  };
}
