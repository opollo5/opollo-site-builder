-- 0069 — AUTH-FOUNDATION P1: SendGrid email log.
--
-- Renumbered from 0031 → 0069 to resolve a version-prefix collision
-- with 0031_optimiser_clients.sql. opt_clients (originally at 0031)
-- has FK dependents at 0032+, so it must keep slot 0031. email_log
-- has no FK dependents, so it tails the chain at 0069. Production
-- recovery for environments where this file's content already
-- applied as version 0031: dispatch deploy-migrations.yml with
-- repair_versions_reverted=0031 (clears the historical row) and
-- repair_versions_applied=0069 (marks this file applied without
-- re-running the CREATE TABLE, since email_log already exists).
-- Fresh environments apply this file normally as version 0069.
--
-- Every transactional email send (success and failure) writes a row
-- here. Phases 2-4 attach to this for invite emails, login-challenge
-- emails, and operator audit visibility.
--
-- Service-role only — no RLS policy is added because all writes come
-- from server-side lib/email/sendgrid.ts and reads are admin-only via
-- the /admin/email-test surface (and a future log viewer).
--
-- Forward-only.

CREATE TABLE email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  sendgrid_message_id text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Inbox-shaped reads ("recent failures", "send history for an address")
-- benefit from a created_at DESC index. PG can also serve the email
-- equality probe through the same composite.
CREATE INDEX email_log_created_at_desc_idx
  ON email_log (created_at DESC);

CREATE INDEX email_log_to_email_created_at_idx
  ON email_log (to_email, created_at DESC);

COMMENT ON TABLE email_log IS
  'Transactional email send log. One row per attempted send (success OR failure). Service-role writes only — no RLS. Added 2026-04-30 (AUTH-FOUNDATION P1).';

COMMENT ON COLUMN email_log.status IS
  '"sent" = SendGrid accepted (2xx). "failed" = 4xx (rejected) or terminal 5xx after retry.';

COMMENT ON COLUMN email_log.sendgrid_message_id IS
  'X-Message-Id header SendGrid returns on accept. NULL on failure.';
