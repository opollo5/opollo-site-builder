-- ---------------------------------------------------------------------------
-- 0024 rollback — restore the original (leaky) read policies WITHOUT the
-- deleted_at IS NULL filter.
--
-- WARNING: applying this rollback re-introduces the soft-delete leakage
-- documented in AUDIT.md §3. Soft-deleted rows in briefs, brief_pages,
-- brief_runs, site_conventions, and posts will again be visible to any
-- authenticated user via direct SELECT. Only roll this back if the
-- forward migration broke an admin-recovery flow that has not yet been
-- migrated to service-role access.
-- ---------------------------------------------------------------------------

BEGIN;

DROP POLICY IF EXISTS briefs_read ON briefs;
CREATE POLICY briefs_read ON briefs
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

DROP POLICY IF EXISTS brief_pages_read ON brief_pages;
CREATE POLICY brief_pages_read ON brief_pages
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

DROP POLICY IF EXISTS brief_runs_read ON brief_runs;
CREATE POLICY brief_runs_read ON brief_runs
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

DROP POLICY IF EXISTS site_conventions_read ON site_conventions;
CREATE POLICY site_conventions_read ON site_conventions
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

DROP POLICY IF EXISTS posts_read ON posts;
CREATE POLICY posts_read ON posts
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

COMMIT;
