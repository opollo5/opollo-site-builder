-- M3-7 — Retry backoff column
--
-- retry_after stamps the earliest clock time at which the lease-next
-- query can pick up a slot that was deferred after a retryable
-- failure. Only consulted when state = 'pending'; other states have
-- their own lifecycle timer (lease_expires_at). NULL means "eligible
-- now" (first attempt, or no retry deferral was set).
--
-- The retry loop in lib/batch-worker.ts (processSlotAnthropic
-- publish-fail branch) sets retry_after on a retryable failure with
-- remaining budget; the leaseNextPage SQL in the same file filters it
-- out when retry_after is in the future.
--
-- Retries are capped at 3 attempts per slot, the attempts column
-- already in place carries the counter. A terminal failure at the
-- cap OR on a non-retryable code bypasses retry_after entirely.

ALTER TABLE generation_job_pages
  ADD COLUMN retry_after timestamptz;

COMMENT ON COLUMN generation_job_pages.retry_after IS
  'Earliest wall-clock time the lease-next query may pick this slot up. '
  'Set by the retry loop on a retryable failure with remaining budget. '
  'NULL means eligible immediately.';
