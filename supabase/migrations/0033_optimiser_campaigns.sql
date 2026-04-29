-- 0033 — Optimiser: opt_campaigns.
-- Reference: spec §4.1 + §5.1.
--
-- Mirror of Google Ads campaign rows. Synced daily by the ads-data-reading
-- job (Slice 2). external_id is the Ads campaign id; uniqueness is per
-- (client_id, external_id) since one Opollo client may map to one Ads
-- account but the engine will not assume that — the column reads come
-- via GAQL keyed by customer_id, but the join key the engine cares
-- about is (client, external_id).

CREATE TABLE opt_campaigns (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  external_id         text NOT NULL,
  name                text NOT NULL,
  status              text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('enabled', 'paused', 'removed', 'unknown')),

  channel_type        text,
  daily_budget_micros bigint
    CHECK (daily_budget_micros IS NULL OR daily_budget_micros >= 0),

  raw                 jsonb,

  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE UNIQUE INDEX opt_campaigns_client_external_uniq
  ON opt_campaigns (client_id, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_campaigns_client_status_idx
  ON opt_campaigns (client_id, status)
  WHERE deleted_at IS NULL;

ALTER TABLE opt_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_campaigns
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_campaigns_read ON opt_campaigns
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_campaigns_write ON opt_campaigns
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
