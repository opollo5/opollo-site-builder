-- Rollback for 0111_platform_events.sql
-- Drops the platform_events table and all associated indexes + policies.
-- Does NOT restore data â€” all event rows are lost.
-- Intended for local dev / CI reset, not production recovery.

DROP POLICY IF EXISTS authenticated_read_own_company ON platform_events;
DROP POLICY IF EXISTS service_role_all ON platform_events;

ALTER TABLE IF EXISTS platform_events DISABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS idx_platform_events_unsent_notifications;
DROP INDEX IF EXISTS idx_platform_events_correlation;
DROP INDEX IF EXISTS idx_platform_events_company;
DROP INDEX IF EXISTS idx_platform_events_dedup;
DROP INDEX IF EXISTS idx_platform_events_entity;

DROP TABLE IF EXISTS platform_events;

