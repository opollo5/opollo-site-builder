-- Rollback for 0126_reliability_and_cap_foundations.sql
-- Reverses all additive schema changes from 0126.
-- Does NOT revert the social_error_class enum ADD VALUE ('worker_died') —
-- Postgres does not support removing enum values.
-- Intended for local dev / CI reset, not production recovery.

-- 12. Restore original platform_events CHECK constraint
ALTER TABLE IF EXISTS platform_events
  DROP CONSTRAINT IF EXISTS platform_events_event_type_check;

ALTER TABLE IF EXISTS platform_events
  ADD CONSTRAINT platform_events_event_type_check
    CHECK (event_type IN (
      'compose_opened', 'compose_closed',
      'draft_saved', 'draft_save_failed', 'draft_recovered', 'draft_conflict',
      'publish_started', 'publish_succeeded', 'publish_failed',
      'ai_generated', 'ai_failed',
      'reconnect_started', 'reconnect_completed',
      'connection_broken', 'connection_expired', 'connection_pre_expiry',
      'notification_emitted',
      'approval_requested', 'approval_granted', 'approval_rejected'
    ));

-- 11. Drop extend_lease RPC
DROP FUNCTION IF EXISTS extend_lease(uuid, int);

-- 10. Drop session grants
DROP INDEX   IF EXISTS idx_platform_session_grants_token_lookup;
DROP TABLE   IF EXISTS platform_session_grants;

-- 9. Drop fan-out trigger
DROP TRIGGER IF EXISTS trg_fan_out_event_to_subscriptions ON platform_events;
DROP FUNCTION IF EXISTS fan_out_event_to_subscriptions();

-- 8. Drop webhook delivery tables (deliveries first — FK child)
DROP INDEX   IF EXISTS idx_platform_event_deliveries_in_flight;
DROP INDEX   IF EXISTS idx_platform_event_deliveries_pending;
DROP TABLE   IF EXISTS platform_event_deliveries;

DROP INDEX   IF EXISTS idx_platform_event_subscriptions_active;
DROP TABLE   IF EXISTS platform_event_subscriptions;

-- 7. Drop timezone provenance columns on platform_companies
ALTER TABLE IF EXISTS platform_companies
  DROP COLUMN IF EXISTS timezone_source,
  DROP COLUMN IF EXISTS timezone_confirmed_at,
  DROP COLUMN IF EXISTS timezone_confirmed_by;

-- 6. Drop timezone columns on social_connections
ALTER TABLE IF EXISTS social_connections
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS detected_timezone;

-- 5. Drop rate limits table
DROP TRIGGER IF EXISTS trg_social_rate_limits_updated ON social_rate_limits;
DROP INDEX   IF EXISTS idx_social_rate_limits_active;
DROP TABLE   IF EXISTS social_rate_limits;

-- 4. Drop retry/lease columns on social_publish_attempts
DROP INDEX   IF EXISTS idx_social_publish_attempts_lease_expiry;
DROP INDEX   IF EXISTS idx_social_publish_attempts_next_retry;
ALTER TABLE IF EXISTS social_publish_attempts
  DROP COLUMN IF EXISTS worker_id,
  DROP COLUMN IF EXISTS claimed_until,
  DROP COLUMN IF EXISTS dead_lettered_at,
  DROP COLUMN IF EXISTS next_retry_at,
  DROP COLUMN IF EXISTS max_retries;

-- 3. Drop campaign columns on social_post_master
DROP INDEX   IF EXISTS idx_social_post_master_campaign;
ALTER TABLE IF EXISTS social_post_master
  DROP COLUMN IF EXISTS sequence_predecessor_id,
  DROP COLUMN IF EXISTS campaign_phase,
  DROP COLUMN IF EXISTS sequence_index,
  DROP COLUMN IF EXISTS campaign_id;

-- 2. Drop social_campaigns
DROP TRIGGER IF EXISTS trg_social_campaigns_updated ON social_campaigns;
DROP INDEX   IF EXISTS idx_social_campaigns_active_range;
DROP INDEX   IF EXISTS idx_social_campaigns_company;
DROP TABLE   IF EXISTS social_campaigns;

-- 1. Drop idempotency columns on social_post_drafts
DROP INDEX   IF EXISTS idx_social_post_drafts_idempotency;
ALTER TABLE IF EXISTS social_post_drafts
  DROP COLUMN IF EXISTS idempotency_key;
