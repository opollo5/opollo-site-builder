-- ---------------------------------------------------------------------------
-- DI-001: social_post_approval_decisions.approver_user_id was NOT NULL, but
-- external approvers have no platform user ID (D5: the JWT review token IS
-- the auth credential). Every external approval/rejection silently failed
-- the constraint and wrote no audit row. Making the column nullable restores
-- the audit trail for external decisions.
--
-- Also adds approver_email (nullable) for future external-approver identity
-- capture when the token claims include the recipient email.
-- ---------------------------------------------------------------------------

ALTER TABLE social_post_approval_decisions
  ALTER COLUMN approver_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS approver_email TEXT;

-- ---------------------------------------------------------------------------
-- DI-009: The insert_as_approver policy (WITH CHECK approver_user_id =
-- auth.uid()) is dead code — all production inserts go via the service role
-- which bypasses RLS. The policy's only practical effect was to allow any
-- authenticated Supabase client to insert a forged decision row naming any
-- user_id they chose. Removing it locks inserts to service_role only, which
-- is the actual production path.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS insert_as_approver ON social_post_approval_decisions;
