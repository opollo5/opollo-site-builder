-- ---------------------------------------------------------------------------
-- 0023 — RLS NULL-safety on creator-scoped policies.
--
-- AUDIT.md (2026-04-26) §3 RLS spot-check, HIGH severity findings.
--
-- Eight read policies use `created_by = auth.uid()` (or its sub-select form
-- `j.created_by = auth.uid()`) without guarding against NULL. `created_by`
-- is nullable on every affected table because the creator's auth.users
-- row may be hard-deleted (FK is `ON DELETE SET NULL`). When that
-- happens, `NULL = auth.uid()` evaluates to NULL in SQL, which is treated
-- as FALSE in a USING clause — the row becomes invisible to *everyone*
-- including admins (because the admin branch is OR'd against the failing
-- check, but the EXISTS form still requires the row to be matched).
--
-- The audit listed 7 tables; this migration also rewrites
-- `generation_events_read` because it has the identical bug pattern in the
-- same migration as `generation_job_pages_read`. Excluded from the audit
-- table by oversight; included here to keep the fix complete.
--
-- Each policy is dropped and recreated with the same shape, with the
-- single addition of `created_by IS NOT NULL AND` before the equality
-- comparison. Admin-branch behavior is unchanged. Service-role policies
-- are not touched.
--
-- Tables affected:
--   - generation_jobs               (0007:123-125)
--   - generation_job_pages          (0007:243-251) — sub-select via j
--   - generation_events             (0007:285-293) — sub-select via j
--   - regeneration_jobs             (0011:175-177)
--   - regeneration_events           (0011:221-231) — sub-select via j
--   - transfer_jobs                 (0010:486-491)
--   - transfer_job_items            (0010:494-502) — sub-select via j
--   - transfer_events               (0010:504-512) — sub-select via j
-- ---------------------------------------------------------------------------

BEGIN;

-- generation_jobs ----------------------------------------------------------

DROP POLICY IF EXISTS generation_jobs_read ON generation_jobs;
CREATE POLICY generation_jobs_read ON generation_jobs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR (created_by IS NOT NULL AND created_by = auth.uid())
  );

-- generation_job_pages -----------------------------------------------------

DROP POLICY IF EXISTS generation_job_pages_read ON generation_job_pages;
CREATE POLICY generation_job_pages_read ON generation_job_pages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_job_pages.job_id
        AND (
          public.auth_role() = 'admin'
          OR (j.created_by IS NOT NULL AND j.created_by = auth.uid())
        )
    )
  );

-- generation_events --------------------------------------------------------

DROP POLICY IF EXISTS generation_events_read ON generation_events;
CREATE POLICY generation_events_read ON generation_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_events.job_id
        AND (
          public.auth_role() = 'admin'
          OR (j.created_by IS NOT NULL AND j.created_by = auth.uid())
        )
    )
  );

-- regeneration_jobs --------------------------------------------------------

DROP POLICY IF EXISTS regeneration_jobs_read ON regeneration_jobs;
CREATE POLICY regeneration_jobs_read ON regeneration_jobs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR (created_by IS NOT NULL AND created_by = auth.uid())
  );

-- regeneration_events ------------------------------------------------------

DROP POLICY IF EXISTS regeneration_events_read ON regeneration_events;
CREATE POLICY regeneration_events_read ON regeneration_events
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR EXISTS (
      SELECT 1
      FROM regeneration_jobs j
      WHERE j.id = regeneration_events.regeneration_job_id
        AND j.created_by IS NOT NULL
        AND j.created_by = auth.uid()
    )
  );

-- transfer_jobs ------------------------------------------------------------

DROP POLICY IF EXISTS transfer_jobs_read ON transfer_jobs;
CREATE POLICY transfer_jobs_read ON transfer_jobs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR (created_by IS NOT NULL AND created_by = auth.uid())
  );

-- transfer_job_items -------------------------------------------------------

DROP POLICY IF EXISTS transfer_job_items_read ON transfer_job_items;
CREATE POLICY transfer_job_items_read ON transfer_job_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transfer_jobs j
      WHERE j.id = transfer_job_items.transfer_job_id
        AND (
          public.auth_role() = 'admin'
          OR (j.created_by IS NOT NULL AND j.created_by = auth.uid())
        )
    )
  );

-- transfer_events ----------------------------------------------------------

DROP POLICY IF EXISTS transfer_events_read ON transfer_events;
CREATE POLICY transfer_events_read ON transfer_events
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transfer_jobs j
      WHERE j.id = transfer_events.transfer_job_id
        AND (
          public.auth_role() = 'admin'
          OR (j.created_by IS NOT NULL AND j.created_by = auth.uid())
        )
    )
  );

COMMIT;
