-- M15-2 #10 — Tighten lease-coherent CHECKs on M3/M7/M12 tables.
--
-- transfer_job_items_lease_coherent (M4) already requires
-- `worker_id IS NOT NULL AND lease_expires_at IS NOT NULL` in leased
-- states (see migration 0010). generation_job_pages, regeneration_jobs,
-- and brief_runs have the same structural guarantee in application code
-- but the CHECK only enforces the pending-case (worker_id IS NULL) and
-- leaves active states unchecked.
--
-- This migration drops and re-adds all three CHECKs with NOT VALID,
-- which protects future inserts/updates without scanning existing rows.
-- After verifying no orphan-leased rows in production (worker_id IS NULL
-- in an active state), run VALIDATE to extend coverage to historical rows:
--
--   ALTER TABLE generation_job_pages
--     VALIDATE CONSTRAINT generation_job_pages_lease_coherent;
--   ALTER TABLE regeneration_jobs
--     VALIDATE CONSTRAINT regeneration_jobs_lease_coherent;
--   ALTER TABLE brief_runs
--     VALIDATE CONSTRAINT brief_runs_lease_coherent;
--
-- Safe to deploy as-is; NOT VALID only skips the historical scan.

-- ── generation_job_pages ──────────────────────────────────────────────────────
ALTER TABLE generation_job_pages
  DROP CONSTRAINT generation_job_pages_lease_coherent;

ALTER TABLE generation_job_pages
  ADD CONSTRAINT generation_job_pages_lease_coherent
    CHECK (
      (state = 'pending'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR (state IN ('leased', 'generating', 'validating', 'publishing')
        AND worker_id IS NOT NULL
        AND lease_expires_at IS NOT NULL)
      OR state IN ('succeeded', 'failed', 'skipped')
    ) NOT VALID;

-- ── regeneration_jobs ─────────────────────────────────────────────────────────
ALTER TABLE regeneration_jobs
  DROP CONSTRAINT regeneration_jobs_lease_coherent;

ALTER TABLE regeneration_jobs
  ADD CONSTRAINT regeneration_jobs_lease_coherent
    CHECK (
      (status = 'pending'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR (status = 'running'
        AND worker_id IS NOT NULL
        AND lease_expires_at IS NOT NULL)
      OR status IN ('succeeded', 'failed', 'failed_gates', 'cancelled')
    ) NOT VALID;

-- ── brief_runs ────────────────────────────────────────────────────────────────
ALTER TABLE brief_runs
  DROP CONSTRAINT brief_runs_lease_coherent;

ALTER TABLE brief_runs
  ADD CONSTRAINT brief_runs_lease_coherent
    CHECK (
      (status = 'queued'
        AND worker_id IS NULL
        AND lease_expires_at IS NULL)
      OR (status IN ('running', 'paused')
        AND worker_id IS NOT NULL
        AND lease_expires_at IS NOT NULL)
      OR status IN ('succeeded', 'failed', 'cancelled')
    ) NOT VALID;
