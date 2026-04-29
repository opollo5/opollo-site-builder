-- 0035 — Optimiser: opt_keywords.
-- Reference: spec §4.1 + §5.1.
--
-- One row per (ad_group, keyword text). Phase 1 only stores positive
-- keywords sourced from keyword_view; search_terms are stored in raw
-- as a denormalised audit trail until Slice 2 wires the search_term_view
-- table separately if performance demands it.

CREATE TABLE opt_keywords (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,
  ad_group_id         uuid NOT NULL
    REFERENCES opt_ad_groups(id) ON DELETE CASCADE,

  external_id         text NOT NULL,
  text                text NOT NULL,
  match_type          text NOT NULL DEFAULT 'unknown'
    CHECK (match_type IN ('exact', 'phrase', 'broad', 'unknown')),
  status              text NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('enabled', 'paused', 'removed', 'unknown')),

  raw                 jsonb,

  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE UNIQUE INDEX opt_keywords_ad_group_external_uniq
  ON opt_keywords (ad_group_id, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_keywords_client_idx
  ON opt_keywords (client_id)
  WHERE deleted_at IS NULL;

ALTER TABLE opt_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_keywords
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_keywords_read ON opt_keywords
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_keywords_write ON opt_keywords
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
