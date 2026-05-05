-- 0089 — Fix brief_runs_lease_coherent CHECK constraint.
--
-- Migration 0087 incorrectly grouped 'paused' with 'running', requiring
-- worker_id IS NOT NULL when a run is paused. But brief-runner.ts sets
-- worker_id = NULL and lease_expires_at = NULL on the paused transition
-- (the worker releases the lease so another can resume it). This caused
-- any brief run transition to 'paused' to violate the constraint.
--
-- Fix: move 'paused' into the null-worker group alongside 'queued'.

ALTER TABLE brief_runs
  DROP CONSTRAINT brief_runs_lease_coherent;

ALTER TABLE brief_runs
  ADD CONSTRAINT brief_runs_lease_coherent
    CHECK (
      (status = 'queued'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR (status = 'running'
        AND worker_id IS NOT NULL
        AND lease_expires_at IS NOT NULL)
      OR (status = 'paused'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR status IN ('succeeded', 'failed', 'cancelled')
    ) NOT VALID;
