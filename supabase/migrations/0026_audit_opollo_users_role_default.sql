-- 0026 — Audit fix: align opollo_users.role column default with the trigger's actual insert.
--
-- Reference: MILESTONE_DELIVERY_AUDIT.md (M2 row, 2026-04-27);
-- AUDIT.md §1 "auth audit findings" (HIGH severity).
--
-- The original M1a schema (migration 0002) declared
--   role text NOT NULL DEFAULT 'operator'
-- back when "operator" was the default user shape and the table was
-- service-role-write-only. M2a (migration 0004) added the
-- handle_new_auth_user trigger that inserts every Supabase Auth signup
-- as role='viewer' (with the OPOLLO_FIRST_ADMIN_EMAIL bootstrap promoted
-- to 'admin'). From M2a onwards, the column default has never been the
-- actual signup default — every authenticated user lands as 'viewer'
-- via the trigger, and 'operator' is dead.
--
-- The dead default is misleading: a future migration that direct-inserts
-- a user without going through Supabase Auth would silently get
-- 'operator' role — the wrong shape for any new operator-flow user
-- (who should default to 'viewer' and be explicitly promoted via the
-- M2d admin UI).
--
-- This migration aligns the column default with what handle_new_auth_user
-- actually inserts. Behaviour-preserving: trigger inserts are unchanged
-- (they explicitly set role='viewer' or role='admin' for the bootstrap
-- email). Existing rows are not touched (DEFAULT only applies to new
-- inserts that omit the column). RLS, CHECK constraint, and column
-- type are unchanged.

ALTER TABLE opollo_users
  ALTER COLUMN role SET DEFAULT 'viewer';

COMMENT ON COLUMN opollo_users.role IS
  'Role gate per docs/patterns/rls-policy-test-matrix.md. Default is ''viewer'' (matches handle_new_auth_user trigger from migration 0004). Promotion to ''operator'' or ''admin'' goes through the M2d admin UI under sites.version_lock CAS. CHECK constraint pins the enum to (admin, operator, viewer).';
