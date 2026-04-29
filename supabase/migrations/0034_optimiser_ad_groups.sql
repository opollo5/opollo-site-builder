-- 0034 — Optimiser: opt_ad_groups.
-- Reference: spec §4.1 + §5.1.

CREATE TABLE opt_ad_groups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  campaign_id         uuid NOT NULL
    REFERENCES opt_campaigns(id) ON DELETE CASCADE,

  external_id         text NOT NULL,
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('enabled', 'paused', 'removed', 'unknown')),

  raw                 jsonb,

  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE UNIQUE INDEX opt_ad_groups_client_external_uniq
  ON opt_ad_groups (client_id, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_ad_groups_campaign_idx
  ON opt_ad_groups (campaign_id)
  WHERE deleted_at IS NULL;

ALTER TABLE opt_ad_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_ad_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_ad_groups_read ON opt_ad_groups
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_ad_groups_write ON opt_ad_groups
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
