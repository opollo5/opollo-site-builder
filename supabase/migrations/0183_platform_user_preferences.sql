-- 0183_platform_user_preferences.sql
-- Additive: adds preferences JSONB column to platform_users.
-- Stores per-user UI preferences such as feedback widget intro skip.
-- Mirrors the existing settings JSONB column on platform_companies.
--
-- Schema: { "feedback_skip_intro": true, ... }
-- Written by the platform-owned /api/feedback/preferences endpoint.

ALTER TABLE platform_users
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN platform_users.preferences IS
  'Per-user UI preferences. Keys: feedback_skip_intro (bool).';
