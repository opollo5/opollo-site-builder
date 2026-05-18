-- Combined migration script for social-01 composer workstream PR A.
-- Paste this into the Supabase SQL Editor at:
--   https://app.supabase.com/project/sazapxgmrdaewrkwoxby/sql/new
--
-- Migrations applied (in order):
--   0127 — bridging: adds state/content/media_urls/etc to social_post_drafts
--   0131 — recurring draft support
--   0132 — planned_for_at + state machine CHECK constraint
--   0133 — published metadata columns
--   0134 — analytics cache + approval decisions tables
--   0135 — cron_heartbeats + service_health_events tables

-- ─────────────────────────────────────────────────────────────
-- 0127: Composer base columns (bridging migration)
-- ─────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS state               text        NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS content             text        NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS media_urls          text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_profiles     jsonb       NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS platform_variants   jsonb       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_at        timestamptz,
  ADD COLUMN IF NOT EXISTS approval_required   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approver_user_id    uuid        REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_social_post_drafts_scheduled
  ON social_post_drafts(scheduled_at)
  WHERE state = 'scheduled' AND scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_post_drafts_pending_approval
  ON social_post_drafts(created_at DESC)
  WHERE state = 'pending_approval';

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- 0131: Recurring drafts
-- ─────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN parent_draft_id uuid REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  ADD COLUMN recurrence_rule text,
  ADD COLUMN recurrence_state text,
  ADD COLUMN occurrence_index integer;

ALTER TABLE social_post_drafts
  ADD CONSTRAINT social_post_drafts_recurrence_shape CHECK (
    (parent_draft_id IS NULL AND recurrence_rule IS NULL)
    OR (parent_draft_id IS NULL AND recurrence_rule IS NOT NULL)
    OR (parent_draft_id IS NOT NULL AND recurrence_rule IS NULL)
  );

ALTER TABLE social_post_drafts
  ADD CONSTRAINT social_post_drafts_recurrence_state_valid CHECK (
    recurrence_state IS NULL OR recurrence_state IN ('active', 'paused', 'ended')
  );

CREATE INDEX idx_social_post_drafts_parent_id
  ON social_post_drafts(parent_draft_id)
  WHERE parent_draft_id IS NOT NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- 0132: planned_for_at + state machine CHECK
-- ─────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN planned_for_at timestamptz;

CREATE INDEX idx_social_post_drafts_planned_for_at
  ON social_post_drafts(planned_for_at)
  WHERE state = 'draft' AND planned_for_at IS NOT NULL;

ALTER TABLE social_post_drafts
  ADD CONSTRAINT social_post_drafts_state_valid CHECK (
    state IN (
      'draft',
      'pending_approval',
      'rejected',
      'scheduled',
      'recurring',
      'paused',
      'publishing',
      'published',
      'failed'
    )
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- 0133: Published metadata
-- ─────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE social_post_drafts
  ADD COLUMN published_at timestamptz,
  ADD COLUMN published_url text,
  ADD COLUMN last_publish_error jsonb,
  ADD COLUMN publish_attempts integer NOT NULL DEFAULT 0;

CREATE INDEX idx_social_post_drafts_published_at
  ON social_post_drafts(published_at DESC)
  WHERE state = 'published' AND published_at IS NOT NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- 0134: Analytics cache + approval decisions
-- Uses is_company_member() from migration 0070 (working analog).
-- Brief's auth.user_belongs_to_company() was replaced — migration role
-- cannot CREATE in auth schema, and is_company_member() is the exact
-- equivalent already defined in this database.
-- ─────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE social_post_analytics_cache (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  fetched_at        timestamptz NOT NULL DEFAULT now(),
  impressions       integer,
  engagement_rate   numeric(5, 2),
  reactions         integer,
  shares            integer,
  comments          integer,
  clicks            integer,
  platform_specific jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_social_post_analytics_cache_draft_id_fetched_at
  ON social_post_analytics_cache(draft_id, fetched_at DESC);

ALTER TABLE social_post_analytics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_company ON social_post_analytics_cache
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM social_post_drafts d
      WHERE d.id = social_post_analytics_cache.draft_id
        AND is_company_member(d.company_id)
    )
  );

-- INSERT/UPDATE allowed only via service role (QStash analytics worker) — no public policy

CREATE TABLE social_post_approval_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id          uuid NOT NULL REFERENCES social_post_drafts(id) ON DELETE CASCADE,
  approver_user_id  uuid NOT NULL REFERENCES auth.users(id),
  decision          text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  rejection_reason  text,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  escalation_level  integer NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  CONSTRAINT rejection_reason_required_when_rejected CHECK (
    decision = 'approved' OR (
      decision = 'rejected'
      AND rejection_reason IS NOT NULL
      AND char_length(rejection_reason) BETWEEN 30 AND 500
    )
  )
);

CREATE INDEX idx_social_post_approval_decisions_draft_id
  ON social_post_approval_decisions(draft_id);

ALTER TABLE social_post_approval_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_company ON social_post_approval_decisions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM social_post_drafts d
      WHERE d.id = social_post_approval_decisions.draft_id
        AND is_company_member(d.company_id)
    )
  );

CREATE POLICY insert_as_approver ON social_post_approval_decisions
  FOR INSERT
  WITH CHECK (
    approver_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM social_post_drafts d
      WHERE d.id = draft_id
        AND is_company_member(d.company_id)
    )
  );

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- 0135: cron_heartbeats + service_health_events
-- Uses is_opollo_staff() — brief's 'platform_admin' role does not exist
-- in platform_company_role enum; is_opollo_staff() is the correct gate.
-- ─────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE cron_heartbeats (
  job_name      text PRIMARY KEY,
  last_run_at   timestamptz NOT NULL,
  last_status   text NOT NULL CHECK (last_status IN ('ok', 'error')),
  last_error    jsonb,
  run_count     integer NOT NULL DEFAULT 0
);

INSERT INTO cron_heartbeats (job_name, last_run_at, last_status) VALUES
  ('publish-due',            NOW(), 'ok'),
  ('cleanup-cache',          NOW(), 'ok'),
  ('escalate-approvals',     NOW(), 'ok'),
  ('health-check',           NOW(), 'ok'),
  ('health-digest',          NOW(), 'ok'),
  ('heartbeat-check',        NOW(), 'ok')
ON CONFLICT (job_name) DO NOTHING;

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

CREATE INDEX idx_service_health_events_active
  ON service_health_events (service_name, event_type)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_service_health_events_recent
  ON service_health_events (last_seen_at DESC);

CREATE INDEX idx_service_health_events_needs_notify
  ON service_health_events (severity, notified_at)
  WHERE resolved_at IS NULL AND severity = 'critical';

ALTER TABLE service_health_events ENABLE ROW LEVEL SECURITY;

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

COMMIT;
