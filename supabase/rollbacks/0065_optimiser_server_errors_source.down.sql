-- Rollback 0065 — restore opt_metrics_daily.source CHECK without 'server_errors'.
--
-- Pre-flight: caller must remove any existing rows with source='server_errors'
-- (otherwise the constraint replacement fails). The optimiser server-errors
-- sync writes idempotently, so deleting these rows just means the next sync
-- run will rewrite them — no permanent data loss for live rollouts.

DELETE FROM opt_metrics_daily WHERE source = 'server_errors';

ALTER TABLE opt_metrics_daily
  DROP CONSTRAINT IF EXISTS opt_metrics_daily_source_check;

ALTER TABLE opt_metrics_daily
  ADD CONSTRAINT opt_metrics_daily_source_check
    CHECK (source IN (
      'google_ads',
      'clarity',
      'ga4',
      'pagespeed'
    ));
