-- ---------------------------------------------------------------------------
-- 0177a_portal_contact.sql
--
-- B4 Client Portal (Step 1 of 2 schema migrations).
-- Adds the client contact fields to platform_companies.
--
-- Who gets the pre-expiry warning and reconnect-invite emails when
-- a company's social connection expires? The operator may designate an
-- external contact; if not set, the application falls back to the
-- company's primary admin (app layer, not schema).
--
-- Two fields only:
--   portal_contact_email — the email address to notify
--   portal_contact_name  — display name for the email greeting (optional)
--
-- Both are nullable:
--   NULL email  → fall back to primary admin (determined at send time)
--   NULL name   → use a generic greeting in the email template
--
-- No DEFAULT, no NOT NULL, no backfill. Existing companies start with
-- NULL on both. The admin can populate via the company settings UI (B4
-- Step 7); the cron and invite flows treat NULL as "use admin fallback."
--
-- Intentionally separate from the social_connections pre_expiry columns
-- (migration 0177b) — one logical change per migration.
-- ---------------------------------------------------------------------------

ALTER TABLE platform_companies
  ADD COLUMN IF NOT EXISTS portal_contact_email text,
  ADD COLUMN IF NOT EXISTS portal_contact_name  text;

COMMENT ON COLUMN platform_companies.portal_contact_email IS
  'Optional external contact for B4 client portal notifications '
  '(pre-expiry warnings, reconnect invites). NULL = fall back to the '
  'company''s primary admin email at send time.';

COMMENT ON COLUMN platform_companies.portal_contact_name IS
  'Display name used in the salutation of portal notification emails. '
  'NULL = generic greeting.';
