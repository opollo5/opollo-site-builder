-- =============================================================================
-- 0093 — Update RLS policies for AUTH-FOUNDATION P3 role rename.
--
-- Migration 0063 renamed roles: viewer→user, operator→admin, admin→super_admin.
-- RLS policies in migrations 0005, 0007, 0010, 0012, 0013, 0019, and 0024
-- still check for the old role names ('viewer', 'operator', 'admin' as
-- top-tier). This migration rewrites all affected policies to use new names.
--
-- Mapping applied:
--   IN ('admin', 'operator', 'viewer') → IN ('super_admin', 'admin', 'user')
--   IN ('admin', 'operator')           → IN ('super_admin', 'admin')
--   = 'admin'                          → = 'super_admin'
--   = 'admin' OR created_by = ...      → = 'super_admin' OR created_by = ...
-- =============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- From 0005_m2b_rls_policies.sql: sites, design_systems, design_components,
-- design_templates, pages, opollo_users
-- ----------------------------------------------------------------------------

ALTER POLICY sites_read ON sites
  USING (public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY sites_write ON sites
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY design_systems_read ON design_systems
  USING (public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY design_systems_write ON design_systems
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY design_components_read ON design_components
  USING (public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY design_components_write ON design_components
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY design_templates_read ON design_templates
  USING (public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY design_templates_write ON design_templates
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY pages_read ON pages
  USING (public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY pages_write ON pages
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY opollo_users_self_read ON opollo_users
  USING (id = auth.uid() OR public.auth_role() = 'super_admin');

ALTER POLICY opollo_users_admin_write ON opollo_users
  USING      (public.auth_role() = 'super_admin')
  WITH CHECK (public.auth_role() = 'super_admin');

-- ----------------------------------------------------------------------------
-- From 0007_m3_1_batch_schema.sql: generation_jobs, generation_job_pages,
-- generation_events
-- ----------------------------------------------------------------------------

ALTER POLICY generation_jobs_read ON generation_jobs
  USING (public.auth_role() = 'super_admin' OR created_by = auth.uid());

ALTER POLICY generation_job_pages_read ON generation_job_pages
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_job_pages.job_id
        AND (public.auth_role() = 'super_admin' OR j.created_by = auth.uid())
    )
  );

ALTER POLICY generation_events_read ON generation_events
  USING (
    EXISTS (
      SELECT 1 FROM generation_jobs j
      WHERE j.id = generation_events.job_id
        AND (public.auth_role() = 'super_admin' OR j.created_by = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- From 0010_m4_1_image_library_schema.sql: image_library, image_metadata,
-- image_usage, transfer_jobs
-- ----------------------------------------------------------------------------

ALTER POLICY image_library_read ON image_library
  USING (deleted_at IS NULL AND public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY image_library_write ON image_library
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY image_library_update ON image_library
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY image_metadata_read ON image_metadata
  USING (public.auth_role() IN ('super_admin', 'admin', 'user'));

ALTER POLICY image_metadata_write ON image_metadata
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY image_metadata_update ON image_metadata
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY image_usage_read ON image_usage
  USING (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY transfer_jobs_read ON transfer_jobs
  USING (
    public.auth_role() = 'super_admin'
    OR created_by = auth.uid()
  );

-- ----------------------------------------------------------------------------
-- From 0012_m8_1_tenant_cost_budgets.sql: tenant_cost_budgets
-- ----------------------------------------------------------------------------

ALTER POLICY tenant_cost_budgets_read ON tenant_cost_budgets
  USING (public.auth_role() IN ('super_admin', 'admin'));

-- ----------------------------------------------------------------------------
-- From 0013_m12_1_briefs_schema.sql: briefs, brief_pages, brief_runs,
-- site_conventions (write policies — read policies already rewritten by 0024
-- but still using old role names there)
-- ----------------------------------------------------------------------------

ALTER POLICY briefs_insert ON briefs
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY briefs_update ON briefs
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY briefs_delete ON briefs
  USING (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY brief_pages_insert ON brief_pages
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY brief_pages_update ON brief_pages
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY brief_pages_delete ON brief_pages
  USING (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY brief_runs_insert ON brief_runs
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY brief_runs_update ON brief_runs
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY brief_runs_delete ON brief_runs
  USING (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY site_conventions_insert ON site_conventions
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY site_conventions_update ON site_conventions
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY site_conventions_delete ON site_conventions
  USING (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY site_briefs_authed_read ON storage.objects
  USING (
    bucket_id = 'site-briefs'
    AND public.auth_role() IN ('super_admin', 'admin', 'user')
  );

-- ----------------------------------------------------------------------------
-- From 0019_m13_1_posts_schema.sql: posts write policies
-- ----------------------------------------------------------------------------

ALTER POLICY posts_insert ON posts
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY posts_update ON posts
  USING      (public.auth_role() IN ('super_admin', 'admin'))
  WITH CHECK (public.auth_role() IN ('super_admin', 'admin'));

ALTER POLICY posts_delete ON posts
  USING (public.auth_role() IN ('super_admin', 'admin'));

-- ----------------------------------------------------------------------------
-- From 0024_audit_soft_delete_rls.sql: read policies for briefs, brief_pages,
-- brief_runs, site_conventions, posts (dropped+recreated in 0024, still old
-- role names)
-- ----------------------------------------------------------------------------

DROP POLICY IF EXISTS briefs_read ON briefs;
CREATE POLICY briefs_read ON briefs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('super_admin', 'admin', 'user')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS brief_pages_read ON brief_pages;
CREATE POLICY brief_pages_read ON brief_pages
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('super_admin', 'admin', 'user')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS brief_runs_read ON brief_runs;
CREATE POLICY brief_runs_read ON brief_runs
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('super_admin', 'admin', 'user')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS site_conventions_read ON site_conventions;
CREATE POLICY site_conventions_read ON site_conventions
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('super_admin', 'admin', 'user')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS posts_read ON posts;
CREATE POLICY posts_read ON posts
  FOR SELECT TO authenticated
  USING (
    public.auth_role() IN ('super_admin', 'admin', 'user')
    AND deleted_at IS NULL
  );

COMMIT;
