-- 0111 -- platform_events table.
-- Reference: ADR 0004, Build Proposal v2 Week 0 item 0.4.
--
-- Dual purpose:
--   1. Audit log -- records significant platform-layer events (connection
--      broken, post published, approval requested, etc.) for operator
--      visibility and compliance.
--   2. Notification dedup store -- the notification cron checks this table
--      before sending any email/in-app notification to enforce the cadence
--      windows defined in ADR 0004.
--
-- Design decisions encoded here:
--
-- 1. event_type is a TEXT CHECK rather than a Postgres ENUM. Enums cannot
--    be easily extended without a migration; CHECK constraints are trivially
--    extended with ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT.
--
-- 2. entity_type + entity_id is a generic polymorphic pointer. Allows
--    referencing any entity (social_connection, post_master, etc.) without
--    a FK column per entity type.
--
-- 3. payload is JSONB -- event-specific data that varies per event_type.
--
-- 4. correlation_id threads a single logical workflow across multiple events.
--    Matches the x-correlation-id header contract in the observability spec.
--
-- 5. notification_sent_at tracks when a notification was dispatched for
--    dedup. NULL = event logged but no notification sent yet. The dedup query:
--      SELECT id FROM platform_events
--      WHERE event_type = $type AND entity_id = $entity_id
--        AND recipient_id = $recipient_id
--        AND notification_sent_at > NOW() - INTERVAL '24 hours'
--      LIMIT 1;
--
-- 6. 365-day retention enforced at application layer (scheduled cleanup job).
--    Rows older than 365 days are archived to S3 before deletion per
--    docs/architecture/DATA_CONVENTIONS.md.
--
-- Write-safety hotspots addressed:
--   - INSERT-only table. No UPDATE outside of notification_sent_at (set once).
--   - notification_sent_at updates are idempotent. Safe to retry.
--   - No version_lock needed -- append-only with no conflict semantics.

CREATE TABLE platform_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        REFERENCES platform_companies(id) ON DELETE SET NULL,
  actor_id             UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  event_type           TEXT        NOT NULL,
  entity_type          TEXT,
  entity_id            UUID,
  payload              JSONB,
  correlation_id       UUID,
  -- Notification tracking
  recipient_id         UUID        REFERENCES platform_users(id) ON DELETE SET NULL,
  notification_channel TEXT        CHECK (notification_channel IN ('email', 'inapp', 'both')),
  notification_sent_at TIMESTAMPTZ,
  -- Audit
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT platform_events_event_type_check
    CHECK (event_type IN (
      'compose_opened', 'compose_closed',
      'draft_saved', 'draft_save_failed', 'draft_recovered', 'draft_conflict',
      'publish_started', 'publish_succeeded', 'publish_failed',
      'ai_generated', 'ai_failed',
      'reconnect_started', 'reconnect_completed',
      'connection_broken', 'connection_expired', 'connection_pre_expiry',
      'notification_emitted',
      'approval_requested', 'approval_granted', 'approval_rejected'
    ))
);

-- Look up all events for a specific entity.
CREATE INDEX idx_platform_events_entity
  ON platform_events (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Notification dedup query.
CREATE INDEX idx_platform_events_dedup
  ON platform_events (event_type, entity_id, recipient_id, notification_sent_at)
  WHERE notification_sent_at IS NOT NULL;

-- Company-scoped event feed.
CREATE INDEX idx_platform_events_company
  ON platform_events (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

-- Correlation ID trace.
CREATE INDEX idx_platform_events_correlation
  ON platform_events (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- Unsent notifications pending dispatch.
CREATE INDEX idx_platform_events_unsent_notifications
  ON platform_events (created_at)
  WHERE notification_sent_at IS NULL AND recipient_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON platform_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY authenticated_read_own_company ON platform_events
  FOR SELECT TO authenticated
  USING (
    company_id IN (
      SELECT company_id
      FROM platform_company_users
      WHERE user_id = auth.uid()
    )
  );
