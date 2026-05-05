-- Rollback for 0070_platform_foundation.sql
-- Drops every platform_* and social_* object the forward migration created.
-- Does NOT restore row data. Intended for local dev / CI reset, not
-- production recovery. set_updated_at() is left in place since it is shared
-- with future migrations (0070 was its first introduction; once a later
-- migration also references it, this drop becomes a hazard — leave it).

-- ----------------------------------------------------------------------------
-- Tables — dropped child-first; CASCADE handles policies, indexes, triggers.
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS social_webhook_events CASCADE;
DROP TABLE IF EXISTS social_publish_attempts CASCADE;
DROP TABLE IF EXISTS social_publish_jobs CASCADE;
DROP TABLE IF EXISTS social_schedule_entries CASCADE;
DROP TABLE IF EXISTS social_viewer_links CASCADE;
DROP TABLE IF EXISTS social_approval_events CASCADE;
DROP TABLE IF EXISTS social_approval_recipients CASCADE;
DROP TABLE IF EXISTS social_approval_requests CASCADE;
DROP TABLE IF EXISTS social_media_assets CASCADE;
DROP TABLE IF EXISTS social_post_variant CASCADE;
DROP TABLE IF EXISTS social_post_master CASCADE;
DROP TABLE IF EXISTS social_connection_alerts CASCADE;
DROP TABLE IF EXISTS social_connections CASCADE;
DROP TABLE IF EXISTS platform_notifications CASCADE;
DROP TABLE IF EXISTS platform_invitations CASCADE;
DROP TABLE IF EXISTS platform_company_users CASCADE;
DROP TABLE IF EXISTS platform_users CASCADE;
DROP TABLE IF EXISTS platform_companies CASCADE;

-- ----------------------------------------------------------------------------
-- Functions — drop standalone helpers. Functions whose signature uses an
-- enum type drop with the type via the CASCADE below.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS is_opollo_staff() CASCADE;
DROP FUNCTION IF EXISTS is_company_member(UUID) CASCADE;
DROP FUNCTION IF EXISTS current_user_company() CASCADE;
DROP FUNCTION IF EXISTS track_post_state_change() CASCADE;

-- ----------------------------------------------------------------------------
-- Types — drop after the tables and functions that reference them. CASCADE
-- removes any dependent has_company_role(uuid, platform_company_role) etc.
-- ----------------------------------------------------------------------------

DROP TYPE IF EXISTS platform_company_role CASCADE;
DROP TYPE IF EXISTS platform_invitation_status CASCADE;
DROP TYPE IF EXISTS platform_notification_type CASCADE;
DROP TYPE IF EXISTS social_platform CASCADE;
DROP TYPE IF EXISTS social_post_state CASCADE;
DROP TYPE IF EXISTS social_post_source CASCADE;
DROP TYPE IF EXISTS social_connection_status CASCADE;
DROP TYPE IF EXISTS social_approval_rule CASCADE;
DROP TYPE IF EXISTS social_approval_event_type CASCADE;
DROP TYPE IF EXISTS social_attempt_status CASCADE;
DROP TYPE IF EXISTS social_error_class CASCADE;
DROP TYPE IF EXISTS social_alert_severity CASCADE;
