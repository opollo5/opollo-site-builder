-- =============================================================================
-- 0126 — Reliability and CAP foundations.
-- Reference: docs/specs/Opollo_Social_Platform_Spec_v1.0.docx §2.1
--
-- Additive only. No drops, no destructive changes.
-- All new columns are nullable or have defaults so existing rows remain valid.
--
-- Write-safety hotspots:
--   - UNIQUE (company_id, idempotency_key) partial index on social_post_drafts
--     makes CAP retry semantics correct at the DB layer.
--   - UNIQUE (connection_id, window_starts_at) on social_rate_limits prevents
--     duplicate window rows from concurrent workers.
--   - UNIQUE (subscription_id, event_id) on platform_event_deliveries defends
--     against the fan-out trigger firing twice under replication lag.
--   - UNIQUE token_hash on platform_session_grants ensures each magic link is
--     consumed at most once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extend social_error_class enum with worker_died.
-- Spec §2.4: watchdog marks crashed-worker attempts with error_class =
-- 'worker_died'. ALTER TYPE ... ADD VALUE IF NOT EXISTS is PG13+.
-- ---------------------------------------------------------------------------
ALTER TYPE social_error_class ADD VALUE IF NOT EXISTS 'worker_died';

-- ---------------------------------------------------------------------------
-- 1. Idempotency for draft creation (spec §2.1)
-- ---------------------------------------------------------------------------
ALTER TABLE social_post_drafts
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_post_drafts_idempotency
  ON social_post_drafts (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Campaign model (spec §2.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_campaigns (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  description   text,
  phase_arc     text[]      NOT NULL DEFAULT ARRAY['awareness','education','offer','proof'],
  starts_on     date        NOT NULL,
  ends_on       date        NOT NULL,
  status        text        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','active','paused','completed','cancelled')),
  source_type   social_post_source NOT NULL DEFAULT 'manual',
  created_by    uuid        REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_company
  ON social_campaigns(company_id, status);

CREATE INDEX IF NOT EXISTS idx_social_campaigns_active_range
  ON social_campaigns(company_id, starts_on, ends_on)
  WHERE status = 'active';

CREATE TRIGGER trg_social_campaigns_updated
  BEFORE UPDATE ON social_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON social_campaigns
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY campaigns_access ON social_campaigns
  FOR ALL TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM platform_company_users
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM platform_company_users
      WHERE user_id = auth.uid()
        AND role IN ('editor','approver','admin')
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Wire posts to campaigns (spec §2.1)
-- ---------------------------------------------------------------------------
ALTER TABLE social_post_master
  ADD COLUMN IF NOT EXISTS campaign_id            uuid REFERENCES social_campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sequence_index         int,
  ADD COLUMN IF NOT EXISTS campaign_phase         text
    CHECK (campaign_phase IN ('awareness','education','offer','proof')),
  ADD COLUMN IF NOT EXISTS sequence_predecessor_id uuid REFERENCES social_post_master(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_post_master_campaign
  ON social_post_master(campaign_id, sequence_index)
  WHERE campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Retry ceiling and lease tracking on publish attempts (spec §2.1)
-- ---------------------------------------------------------------------------
ALTER TABLE social_publish_attempts
  ADD COLUMN IF NOT EXISTS max_retries      int         NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS next_retry_at    timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_until    timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id        text;

CREATE INDEX IF NOT EXISTS idx_social_publish_attempts_next_retry
  ON social_publish_attempts(next_retry_at)
  WHERE status = 'failed' AND dead_lettered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_social_publish_attempts_lease_expiry
  ON social_publish_attempts(claimed_until)
  WHERE status = 'in_flight';

-- ---------------------------------------------------------------------------
-- 5. Per-connection rate limit tracking (spec §2.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_rate_limits (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     uuid        NOT NULL REFERENCES social_connections(id) ON DELETE CASCADE,
  platform          text        NOT NULL,
  window_starts_at  timestamptz NOT NULL,
  window_resets_at  timestamptz NOT NULL,
  requests_made     int         NOT NULL DEFAULT 0,
  requests_limit    int         NOT NULL,
  last_429_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, window_starts_at)
);

CREATE INDEX IF NOT EXISTS idx_social_rate_limits_active
  ON social_rate_limits(connection_id, window_resets_at);

CREATE TRIGGER trg_social_rate_limits_updated
  BEFORE UPDATE ON social_rate_limits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE social_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON social_rate_limits
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Operators can read rate limit state; only service role writes.
CREATE POLICY rate_limits_operator_read ON social_rate_limits
  FOR SELECT TO authenticated
  USING (
    connection_id IN (
      SELECT sc.id FROM social_connections sc
      JOIN platform_company_users pcu ON pcu.company_id = sc.company_id
      WHERE pcu.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. Per-connection timezone override (spec §2.1)
-- ---------------------------------------------------------------------------
ALTER TABLE social_connections
  ADD COLUMN IF NOT EXISTS timezone          text,
  ADD COLUMN IF NOT EXISTS detected_timezone text;

-- ---------------------------------------------------------------------------
-- 7. Timezone provenance on company (spec §2.1)
-- ---------------------------------------------------------------------------
ALTER TABLE platform_companies
  ADD COLUMN IF NOT EXISTS timezone_source text
    CHECK (timezone_source IN ('default','browser_detected','manager_set','client_confirmed'))
    DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS timezone_confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS timezone_confirmed_by  uuid REFERENCES auth.users(id);

-- ---------------------------------------------------------------------------
-- 8. Outbound webhook delivery — subscriptions + deliveries (spec §2.1 + 2.3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_event_subscriptions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_name      text        NOT NULL,
  webhook_url          text        NOT NULL,
  signing_secret       text        NOT NULL,
  event_types          text[]      NOT NULL,
  company_id_filter    uuid        REFERENCES platform_companies(id) ON DELETE CASCADE,
  active               boolean     NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_delivery_at     timestamptz,
  consecutive_failures int         NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_platform_event_subscriptions_active
  ON platform_event_subscriptions(active)
  WHERE active = true;

ALTER TABLE platform_event_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON platform_event_subscriptions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS platform_event_deliveries (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id      uuid        NOT NULL REFERENCES platform_event_subscriptions(id) ON DELETE CASCADE,
  event_id             uuid        NOT NULL REFERENCES platform_events(id),
  status               text        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','in_flight','delivered','failed','dead_lettered')),
  attempt_count        int         NOT NULL DEFAULT 0,
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  claimed_until        timestamptz,
  last_response_status int,
  last_response_body   text,
  delivered_at         timestamptz,
  dead_lettered_at     timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_event_deliveries_pending
  ON platform_event_deliveries(next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_platform_event_deliveries_in_flight
  ON platform_event_deliveries(claimed_until)
  WHERE status = 'in_flight';

ALTER TABLE platform_event_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON platform_event_deliveries
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 9. Fan-out trigger: on platform_events INSERT, enqueue a delivery row for
--    every matching active subscription. ON CONFLICT DO NOTHING defends
--    against replication-lag double-fires. (spec §2.3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fan_out_event_to_subscriptions()
RETURNS trigger AS $$
BEGIN
  INSERT INTO platform_event_deliveries (subscription_id, event_id, status, next_attempt_at)
  SELECT s.id, NEW.id, 'pending', now()
  FROM   platform_event_subscriptions s
  WHERE  s.active = true
    AND  NEW.event_type = ANY(s.event_types)
    AND  (s.company_id_filter IS NULL OR s.company_id_filter = NEW.company_id)
  ON CONFLICT (subscription_id, event_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fan_out_event_to_subscriptions ON platform_events;
CREATE TRIGGER trg_fan_out_event_to_subscriptions
  AFTER INSERT ON platform_events
  FOR EACH ROW EXECUTE FUNCTION fan_out_event_to_subscriptions();

-- ---------------------------------------------------------------------------
-- 10. Magic-link session grants (spec §2.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_session_grants (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash                  text        NOT NULL UNIQUE,
  user_id                     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id                  uuid        NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  grant_type                  text        NOT NULL
                                CHECK (grant_type IN ('full_session','reconnect_only')),
  scope_connection_id         uuid        REFERENCES social_connections(id),
  issued_at                   timestamptz NOT NULL DEFAULT now(),
  expires_at                  timestamptz NOT NULL,
  consumed_at                 timestamptz,
  consumed_from_ip            inet,
  consumed_from_user_agent    text,
  second_factor_required      boolean     NOT NULL DEFAULT false,
  second_factor_verified_at   timestamptz,
  second_factor_code_hash     text,
  second_factor_expires_at    timestamptz,
  revoked_at                  timestamptz,
  revocation_reason           text
);

-- Fast token lookup; filters to unclaimed, unrevoked grants only.
CREATE INDEX IF NOT EXISTS idx_platform_session_grants_token_lookup
  ON platform_session_grants(token_hash)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE platform_session_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON platform_session_grants
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 11. extend_lease RPC (spec §2.4)
--     Workers call this when a legitimately long publish needs more time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION extend_lease(p_attempt_id uuid, p_additional_seconds int)
RETURNS void AS $$
BEGIN
  UPDATE social_publish_attempts
  SET    claimed_until = claimed_until + (p_additional_seconds * INTERVAL '1 second')
  WHERE  id = p_attempt_id
    AND  status = 'in_flight'
    AND  claimed_until IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- 12. Extend platform_events.event_type CHECK constraint (spec §6)
--     Drop the old named constraint, re-create with the full event-type set.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_events
  DROP CONSTRAINT IF EXISTS platform_events_event_type_check;

ALTER TABLE platform_events
  ADD CONSTRAINT platform_events_event_type_check
    CHECK (event_type IN (
      -- Composer and draft lifecycle
      'compose_opened', 'compose_closed',
      'draft_saved', 'draft_save_failed', 'draft_recovered', 'draft_conflict',
      -- Publishing lifecycle
      'publish_attempted',
      'publish_started', 'publish_succeeded', 'publish_failed',
      'publish_dead_lettered',
      'publish_late',
      'publish_rate_limited',
      -- AI
      'ai_generated', 'ai_failed',
      -- Connection lifecycle
      'connection_connected',
      'connection_broken', 'connection_expired', 'connection_pre_expiry',
      'connection_lost',
      -- Reconnect lifecycle
      'reconnect_required',
      'reconnect_started', 'reconnect_completed',
      -- Notifications
      'notification_emitted',
      -- Approval lifecycle
      'approval_requested', 'approval_granted', 'approval_rejected',
      -- Scheduling lifecycle
      'schedule_created', 'schedule_due',
      'schedule_skipped', 'schedule_abandoned', 'schedule_blocked',
      -- Campaign lifecycle
      'campaign_created', 'campaign_started', 'campaign_post_dead_lettered',
      'campaign_completed', 'campaign_paused', 'campaign_resumed', 'campaign_cancelled',
      -- System lifecycle
      'worker_died',
      'webhook_dispatched', 'webhook_dispatch_failed', 'subscription_disabled',
      'magic_link_consumed', 'service_action_taken'
    ));

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------
COMMENT ON TABLE social_campaigns IS 'CAP campaign and sequence model. phase_arc defines the ordered content phases; posts link via campaign_id on social_post_master.';
COMMENT ON TABLE social_rate_limits IS 'Per-(connection, window) rate limit state. Used by the publisher to gate calls and back off on 429s.';
COMMENT ON TABLE platform_event_subscriptions IS 'Outbound webhook subscriptions. Fan-out trigger inserts delivery rows; dispatch cron drives delivery.';
COMMENT ON TABLE platform_event_deliveries IS 'One row per (subscription, event). Status machine: pending → in_flight → delivered|failed|dead_lettered.';
COMMENT ON TABLE platform_session_grants IS 'Single-use magic-link tokens for reconnect and approval flows. consumed_at = NULL AND revoked_at = NULL means available.';
