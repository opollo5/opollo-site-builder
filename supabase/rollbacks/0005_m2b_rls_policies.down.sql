-- M2b — Rollback for 0005_m2b_rls_policies.sql
--
-- Hand-run. Drops the 12 user-scoped RLS policies. service_role_all
-- policies on each table stay in place, so service-role clients
-- continue to work after this runs.
--
-- Path to run:
--   psql "$SUPABASE_DB_URL" -f supabase/rollbacks/0005_m2b_rls_policies.down.sql
--
-- Verification:
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'public'
--      AND policyname NOT LIKE 'service_role_%'
--   ORDER BY tablename, policyname;
-- Expected after rollback: 0 rows.

DROP POLICY IF EXISTS opollo_users_admin_write ON opollo_users;
DROP POLICY IF EXISTS opollo_users_self_read ON opollo_users;

DROP POLICY IF EXISTS pages_write ON pages;
DROP POLICY IF EXISTS pages_read ON pages;

DROP POLICY IF EXISTS design_templates_write ON design_templates;
DROP POLICY IF EXISTS design_templates_read ON design_templates;

DROP POLICY IF EXISTS design_components_write ON design_components;
DROP POLICY IF EXISTS design_components_read ON design_components;

DROP POLICY IF EXISTS design_systems_write ON design_systems;
DROP POLICY IF EXISTS design_systems_read ON design_systems;

DROP POLICY IF EXISTS sites_write ON sites;
DROP POLICY IF EXISTS sites_read ON sites;
