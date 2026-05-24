-- Migration 0150: Expand ins_admin_audit action constraint to include competitor actions

ALTER TABLE ins_admin_audit
  DROP CONSTRAINT IF EXISTS ins_admin_audit_action_check;

ALTER TABLE ins_admin_audit
  ADD CONSTRAINT ins_admin_audit_action_check
    CHECK (action IN (
      'view', 'dismiss', 'annotate', 'export', 'override', 'unsuppress',
      'add_competitor', 'remove_competitor'
    ));
