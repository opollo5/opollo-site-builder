-- ---------------------------------------------------------------------------
-- 0023 rollback — restore the original creator-scoped policies WITHOUT the
-- IS NOT NULL guard.
--
-- WARNING: applying this rollback re-introduces the NULL-safety bug
-- documented in AUDIT.md §3 (HIGH severity). When `created_by` is NULL
-- (e.g. creator's auth.users row was hard-deleted), the row becomes
-- invisible to *everyone* including admins. Only roll this back if the
-- forward migration broke something more important than the bug it
-- fixes.
-- ---------------------------------------------------------------------------

BEGIN;

-- generation_jobs ----------------------------------------------------------

DROP POLICY IF EXISTS generation_jobs_read ON generation_jobs;
CREATE POLICY generation_jobs_read ON generation_jobs
  FOR SELECT TO authenticated
  USING (public.auth_role() = 'admin' OR created_by = auth.uid());

-- generation_job_pages -----------------------------------------------------

DROP POLICY IF EXISTS generation_job_pages_read ON generation_job_pages;
CREATE POLICY generation_job_pages_read ON generation_job_pages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_job_pages.job_id
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
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
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
    )
  );

-- regeneration_jobs --------------------------------------------------------

DROP POLICY IF EXISTS regeneration_jobs_read ON regeneration_jobs;
CREATE POLICY regeneration_jobs_read ON regeneration_jobs
  FOR SELECT TO authenticated
  USING (public.auth_role() = 'admin' OR created_by = auth.uid());

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
        AND j.created_by = auth.uid()
    )
  );

-- transfer_jobs ------------------------------------------------------------

DROP POLICY IF EXISTS transfer_jobs_read ON transfer_jobs;
CREATE POLICY transfer_jobs_read ON transfer_jobs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR created_by = auth.uid()
  );

-- transfer_job_items -------------------------------------------------------

DROP POLICY IF EXISTS transfer_job_items_read ON transfer_job_items;
CREATE POLICY transfer_job_items_read ON transfer_job_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM transfer_jobs j
      WHERE j.id = transfer_job_items.transfer_job_id
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
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
        AND (public.auth_role() = 'admin' OR j.created_by = auth.uid())
    )
  );

COMMIT;
