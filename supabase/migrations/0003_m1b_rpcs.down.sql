-- M1b — Rollback for 0003_m1b_rpcs.sql
--
-- Drops activate_design_system. Run before 0002's rollback if tearing down
-- the M1 schema completely. Safe to run on its own — does not affect tables
-- or data.
--
-- Verification steps:
--   1. With the forward migration applied, confirm the function exists:
--        SELECT proname FROM pg_proc WHERE proname = 'activate_design_system';
--      Expected: 1 row.
--   2. Run this file.
--   3. Confirm it is gone:
--        SELECT proname FROM pg_proc WHERE proname = 'activate_design_system';
--      Expected: 0 rows.
--   4. Re-apply 0003 — should succeed with no residue.

DROP FUNCTION IF EXISTS activate_design_system(uuid, integer);
