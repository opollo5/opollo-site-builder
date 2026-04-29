-- 0036 — Optimiser: opt_ads.
-- Reference: spec §4.1 + §5.1.
--
-- One row per RSA ad. Headlines and descriptions are stored as JSON
-- arrays since RSA permits multiple of each and the alignment scorer
-- needs the full set, not just the top-performing variant.

CREATE TABLE opt_ads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  ad_group_id         uuid NOT NULL
    REFERENCES opt_ad_groups(id) ON DELETE CASCADE,

  external_id         text NOT NULL,
  ad_type             text NOT NULL DEFAULT 'unknown',
  status              text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('enabled', 'paused', 'removed', 'unknown')),

  -- ['headline 1', 'headline 2', ...] — order = display order from Ads.
  headlines           jsonb NOT NULL DEFAULT '[]'::jsonb,
  descriptions        jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- final_url is the landing page URL Ads reports for this ad. Joins
  -- to opt_landing_pages by URL match.
  final_url           text,

  raw                 jsonb,

  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE UNIQUE INDEX opt_ads_ad_group_external_uniq
  ON opt_ads (ad_group_id, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_ads_client_idx
  ON opt_ads (client_id)
  WHERE deleted_at IS NULL;

ALTER TABLE opt_ads ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_ads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_ads_read ON opt_ads
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_ads_write ON opt_ads
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
