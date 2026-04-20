-- M2a — Rollback for 0004_m2a_auth_link.sql
--
-- Hand-run. Lives in supabase/rollbacks/ (not supabase/migrations/) per
-- the convention documented in supabase/rollbacks/README.md.
--
-- Drops in reverse dependency order:
--   1. auth_role() helper
--   2. email-sync trigger + function
--   3. insert trigger + function
--   4. opollo_users FK to auth.users
--   5. opollo_config table
--
-- DO NOT run this against a production database that has real users.
-- Dropping the opollo_users FK does not delete any opollo_users rows, but
-- if auth.users is later pruned without the FK in place, those rows
-- become orphans with no cascade path.

DROP FUNCTION IF EXISTS public.auth_role();
DROP TRIGGER IF EXISTS on_auth_user_email_update ON auth.users;
DROP FUNCTION IF EXISTS public.handle_auth_user_email_update();
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user();
ALTER TABLE opollo_users
  DROP CONSTRAINT IF EXISTS opollo_users_id_fkey;
DROP TABLE IF EXISTS opollo_config;
