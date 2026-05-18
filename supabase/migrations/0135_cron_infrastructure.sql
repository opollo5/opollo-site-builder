-- Migration 0135: cron heartbeats + service health events
-- Supports the in-house scheduled-publish queue (replaces QStash) and the
-- service health monitoring system (replaces vendor-side observability).
-- See docs/briefs/social-01/SERVICE_HEALTH.md

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- cron_heartbeats
-- One row per cron job. Updated on every successful run.
-- The heartbeat-check cron compares last_run_at to NOW() and raises
-- a service_health_event if any job is stale.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE cron_heartbeats (
  job_name      text PRIMARY KEY,
  last_run_at   timestamptz NOT NULL,
  last_status   text NOT NULL CHECK (last_status IN ('ok', 'error')),
  last_error    jsonb,
  run_count     integer NOT NULL DEFAULT 0
);

-- Seed the known cron jobs with a baseline so the first heartbeat-check doesn't false-alarm
INSERT INTO cron_heartbeats (job_name, last_run_at, last_status) VALUES
  ('publish-due',            NOW(), 'ok'),
  ('cleanup-cache',          NOW(), 'ok'),
  ('escalate-approvals',     NOW(), 'ok'),
  ('health-check',           NOW(), 'ok'),
  ('health-digest',          NOW(), 'ok'),
  ('heartbeat-check',        NOW(), 'ok')
ON CONFLICT (job_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- service_health_events
-- Single source of truth for "something went wrong with an external service."
-- Populated by withHealthMonitoring wrapper, heartbeat-check cron, and
-- manual admin flags.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE service_health_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name     text NOT NULL,
  operation        text,
  event_type       text NOT NULL CHECK (event_type IN (
                     'service_5xx',
                     'connection_failure',
                     'auth_failure',
                     'billing_failure',
                     'rate_limit',
                     'webhook_auth_failure',
                     'cron_stale',
                     'recovered',
                     'manual_flag'
                   )),
  severity         text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at    timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at     timestamptz NOT NULL DEFAULT NOW(),
  resolved_at      timestamptz,
  notified_at      timestamptz,
  details          jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_by_user_id uuid REFERENCES auth.users(id)
);

-- Hot path: "show me current active alerts for this service"
CREATE INDEX idx_service_health_events_active
  ON service_health_events (service_name, event_type)
  WHERE resolved_at IS NULL;

-- Used by the admin dashboard timeline
CREATE INDEX idx_service_health_events_recent
  ON service_health_events (last_seen_at DESC);

-- Used by the notification cron — "what's critical AND unnotified or stale-notified"
CREATE INDEX idx_service_health_events_needs_notify
  ON service_health_events (severity, notified_at)
  WHERE resolved_at IS NULL AND severity = 'critical';

ALTER TABLE service_health_events ENABLE ROW LEVEL SECURITY;

-- CLAUDE-ASSUMPTION: brief used 'platform_admin' role but DB has no such value;
-- is_opollo_staff() is the correct gate for internal platform observability.
CREATE POLICY opollo_staff_select ON service_health_events
  FOR SELECT
  USING (is_opollo_staff());

CREATE POLICY opollo_staff_insert ON service_health_events
  FOR INSERT
  WITH CHECK (
    raised_by_user_id = auth.uid()
    AND event_type = 'manual_flag'
    AND is_opollo_staff()
  );

CREATE POLICY opollo_staff_update ON service_health_events
  FOR UPDATE
  USING (is_opollo_staff());

-- System-detected events (event_type != 'manual_flag') are written via service role only
-- — no public INSERT policy for those, the wrapper code uses service_role auth.

COMMIT;
