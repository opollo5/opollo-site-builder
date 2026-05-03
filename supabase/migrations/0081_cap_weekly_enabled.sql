-- D4: add cap_weekly_enabled flag to platform_companies.
-- When true the weekly CAP cron generates 3 draft posts for that company.
-- Defaults false; MSP admins toggle it per company.

ALTER TABLE platform_companies
  ADD COLUMN IF NOT EXISTS cap_weekly_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN platform_companies.cap_weekly_enabled IS
  'When true, the weekly CAP cron auto-generates 3 draft social posts.';
