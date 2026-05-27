-- 0153 — platform_staff_audit_log
--
-- Implements D4 from docs/inventory/decisions-locked.md.
-- Append-only audit log for Opollo staff write actions against
-- customer companies. Minimum fields per locked decision:
-- timestamp, staff identity, company identity, action, resource ID,
-- IP address. No before/after diffs; no read logging.
--
-- Forward-only. lib/platform/staff-audit.ts is the write path.

CREATE TABLE platform_staff_audit_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp     TIMESTAMPTZ NOT NULL    DEFAULT now(),
  staff_user_id UUID        NOT NULL    REFERENCES platform_users(id)    ON DELETE SET NULL,
  staff_email   TEXT        NOT NULL,
  company_id    UUID                    REFERENCES platform_companies(id) ON DELETE SET NULL,
  company_name  TEXT,
  action        TEXT        NOT NULL,
  resource_id   TEXT,
  ip_address    TEXT,
  metadata      JSONB       NOT NULL    DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL    DEFAULT now()
);

-- Fast lookups by staff user (compliance queries) and by company (per-company review).
CREATE INDEX idx_staff_audit_log_staff   ON platform_staff_audit_log (staff_user_id, timestamp DESC);
CREATE INDEX idx_staff_audit_log_company ON platform_staff_audit_log (company_id, timestamp DESC)
  WHERE company_id IS NOT NULL;
CREATE INDEX idx_staff_audit_log_time    ON platform_staff_audit_log (timestamp DESC);

-- RLS: only Opollo staff can read; writes are service-role only (no
-- user-facing INSERT/UPDATE/DELETE policies).
ALTER TABLE platform_staff_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_audit_log_staff_read ON platform_staff_audit_log
  FOR SELECT USING (is_opollo_staff());
