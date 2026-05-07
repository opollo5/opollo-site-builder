-- 0107 — Spec 01: extend user_audit_log to record super_admin site purges.
--
-- The hard-delete (POST DELETE /api/sites/[id]/purge — super_admin only,
-- distinct from the soft-archive DELETE /api/sites/[id]) writes one
-- audit row in the same transaction as the cascade.
--
-- Existing user_audit_log shape (from 0063):
--   - action CHECK is enum-style — only user-management verbs allowed.
--     We add 'site_purged' to the list.
--   - target_email was NOT NULL because every prior action has an email
--     target. Site purge has no email; relax to nullable. The site
--     identity lives in metadata as { site_id, site_name }.
--
-- Forward-only. Nothing else depends on target_email being NOT NULL —
-- existing user-management routes always populate it, and the new
-- read surface (super_admin audit viewer) tolerates null already
-- because metadata carries the human-readable target for site_purged.

ALTER TABLE user_audit_log
  DROP CONSTRAINT IF EXISTS user_audit_log_action_check;

ALTER TABLE user_audit_log
  ADD CONSTRAINT user_audit_log_action_check
    CHECK (action IN (
      'invite_sent',
      'invite_revoked',
      'invite_accepted',
      'user_removed',
      'user_reinstated',
      'role_changed',
      'site_purged'
    ));

ALTER TABLE user_audit_log
  ALTER COLUMN target_email DROP NOT NULL;

COMMENT ON COLUMN user_audit_log.target_email IS
  'Operator-visible identity of the action target. Email for invite/role/user-removal actions; NULL for site-scoped actions (site_purged) where the target is identified by metadata.site_id + metadata.site_name instead.';
