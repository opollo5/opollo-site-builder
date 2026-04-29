-- 0038 — Optimiser: opt_metrics_daily.
-- Reference: spec §5.1 (opt_metrics_daily), §4.1/4.2/4.3 (sources).
--
-- Time-series performance data. One row per (landing_page, metric_date,
-- source, dimension). Append-mostly with idempotent UPSERT — the daily
-- sync may re-fetch the last 1–3 days of Clarity data per the API
-- contract (§4.2) so the UNIQUE constraint absorbs rerun.
--
-- The metric payload is JSONB rather than columnar because each source
-- emits a different metric set (Ads = clicks/cost/conversions; GA4 =
-- sessions/engagement_time/scroll_events; Clarity = scroll_depth /
-- dead_clicks / rage_clicks; PSI = LCP/INP/CLS/mobile_score). A flat
-- table per source would balloon the migration count without
-- structural benefit. Slice 2's metric typing lives in lib/optimiser.

CREATE TABLE opt_metrics_daily (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  landing_page_id     uuid NOT NULL
    REFERENCES opt_landing_pages(id) ON DELETE CASCADE,

  metric_date         date NOT NULL,
  source              text NOT NULL
    CHECK (source IN ('google_ads', 'clarity', 'ga4', 'pagespeed')),

  -- Optional dimension breakdown (e.g. device = mobile / desktop /
  -- tablet, country, source). Empty string is the all-traffic default
  -- (NULL would have to be split-special-cased in the unique index).
  dimension_key       text NOT NULL DEFAULT '',
  dimension_value     text NOT NULL DEFAULT '',

  metrics             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- raw is the verbatim API row for forensic reconstruction without
  -- re-querying the upstream. Optional — the engine reads metrics for
  -- analysis but raw is the audit fallback.
  raw                 jsonb,

  ingested_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotent UPSERT key. Phase 1 sync rewrites the same (page, date,
-- source, dimension) tuple if rerun within the source's freshness
-- window. (PSI's weekly cadence and Clarity's 1–3 day window both
-- benefit from this.)
CREATE UNIQUE INDEX opt_metrics_daily_uniq
  ON opt_metrics_daily (
    landing_page_id, metric_date, source, dimension_key, dimension_value
  );

CREATE INDEX opt_metrics_daily_page_date_idx
  ON opt_metrics_daily (landing_page_id, metric_date DESC);

CREATE INDEX opt_metrics_daily_client_date_idx
  ON opt_metrics_daily (client_id, metric_date DESC);

ALTER TABLE opt_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_metrics_daily
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_metrics_daily_read ON opt_metrics_daily
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
