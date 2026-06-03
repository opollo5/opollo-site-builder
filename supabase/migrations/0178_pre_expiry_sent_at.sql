-- ---------------------------------------------------------------------------
-- 0178_pre_expiry_sent_at.sql
--
-- B4 Client Portal (Step 2 of 2 schema migrations).
-- Adds deduplication columns to social_connections for the pre-expiry
-- warning cron.
--
-- The cron (B4 Step 6) fires at 7 days and 1 day before expires_at and
-- sends the portal_contact_email a reconnect invite. Without a record of
-- which notices have already been sent, the cron would spam on every tick.
-- These columns prevent that: the cron writes them atomically when it
-- sends each notice, and skips rows where they are already set.
--
-- Column semantics:
--   pre_expiry_7d_sent_at — timestamptz of when the "7 days left" email
--                           was sent. NULL = not yet sent for this expiry.
--   pre_expiry_1d_sent_at — timestamptz of when the "1 day left" email
--                           was sent. NULL = not yet sent for this expiry.
--
-- Reset behaviour: when a connection is successfully reconnected (status
-- flips back to healthy and expires_at is updated), the application layer
-- must NULL these columns so the next expiry cycle can send fresh notices.
-- There is no ON UPDATE trigger — the reset is explicit and auditable.
--
-- Scope constraint (CLAUDE.md B4 hard rule):
--   The pre-expiry cron may ONLY write these two columns.
--   It must NOT write status, token, external_identity_hash,
--   external_account_id, or any binding-related field.
--   This constraint is enforced at the application layer and documented
--   here so future builders know the intent.
--
-- Intentionally separate from migration 0177 (portal_contact_* on
-- platform_companies) — one logical change per migration.
-- ---------------------------------------------------------------------------

ALTER TABLE social_connections
  ADD COLUMN IF NOT EXISTS pre_expiry_7d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_expiry_1d_sent_at timestamptz;

COMMENT ON COLUMN social_connections.pre_expiry_7d_sent_at IS
  'Set when the "7 days until expiry" portal notification is sent. '
  'NULL = notice not yet sent for the current expiry cycle. '
  'Must be NULLed by the app when expires_at is refreshed on reconnect.';

COMMENT ON COLUMN social_connections.pre_expiry_1d_sent_at IS
  'Set when the "1 day until expiry" portal notification is sent. '
  'NULL = notice not yet sent for the current expiry cycle. '
  'Must be NULLed by the app when expires_at is refreshed on reconnect.';
