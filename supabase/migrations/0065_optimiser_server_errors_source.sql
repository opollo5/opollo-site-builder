-- 0065 — Optimiser: extend opt_metrics_daily.source to include 'server_errors'.
-- Reference: spec §12.2.1 (rollback thresholds — error_rate),
-- staged-rollout/metrics.ts (errors_new feed), Phase 1.5 follow-up.
--
-- The staged rollout monitor evaluates an error_rate threshold to
-- auto-revert a rollout. Until this slice landed, the metric fetcher
-- hard-coded errors_new to 0 because no source emitted 5xx counts to
-- opt_metrics_daily. Slice D wires Vercel logs as that source.
--
-- The metrics JSONB shape for source='server_errors':
--   { errors_5xx: number, total_requests: number, sampled_window_hours: number }
--
-- Idempotent UPSERT key (landing_page_id, metric_date, source,
-- dimension_key, dimension_value) is unchanged. Vercel sync runs daily
-- at 11:00 UTC and rewrites the previous 24h worth of rows.

ALTER TABLE opt_metrics_daily
  DROP CONSTRAINT IF EXISTS opt_metrics_daily_source_check;

ALTER TABLE opt_metrics_daily
  ADD CONSTRAINT opt_metrics_daily_source_check
    CHECK (source IN (
      'google_ads',
      'clarity',
      'ga4',
      'pagespeed',
      'server_errors'
    ));

COMMENT ON COLUMN opt_metrics_daily.source IS
  'Data source. server_errors added 2026-05-01 (OPTIMISER P1.5 follow-up — Vercel logs feed for staged-rollout error_rate threshold).';
