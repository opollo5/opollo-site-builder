-- 0037 — Optimiser: opt_landing_pages.
-- Reference: spec §3.4 (external pages), §5.1, §7.4 (managed flag), §9.9
-- (healthy state), §9.6.3 (technical alerts).
--
-- Design decisions encoded here:
--
-- 1. management_mode = 'read_only' | 'full_automation'. The
--    schema-level invariant from §3.4: full_automation requires
--    page_id to point at a Site-Builder pages row. Enforced via a
--    coherence CHECK rather than a trigger so the constraint is
--    reasoned about in one place.
--
-- 2. state is the §9.9 page-browser state machine: active /
--    healthy / insufficient_data / read_only_external. CHECK
--    constraint over an ENUM keeps Phase 2 additions cheap.
--
-- 3. managed boolean from §7.4: a page that's been imported but
--    not yet selected for active engine management lives with
--    managed = false. Sync jobs (Slice 2) ingest data only when
--    managed = true.
--
-- 4. core_offer is free text per §10 — any change to this field
--    is flagged high-risk by the proposal generator. Stored here
--    rather than on a side table because it's a single string and
--    every reader needs it.
--
-- 5. page_snapshot JSONB holds the H1 / primary_cta / hero_copy
--    extracted at last analysis (§5.1 description for opt_landing_pages).
--    Updated by the page-content-analysis skill.

CREATE TABLE opt_landing_pages (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL
    REFERENCES opt_clients(id) ON DELETE CASCADE,

  url                      text NOT NULL,
  display_name             text,

  managed                  boolean NOT NULL DEFAULT false,

  management_mode          text NOT NULL DEFAULT 'read_only'
    CHECK (management_mode IN ('read_only', 'full_automation')),

  -- FK to Site Builder's existing pages table for full-automation pages.
  -- ON DELETE SET NULL drops the link without nuking the optimiser row;
  -- the engine downgrades the page to read_only by application logic
  -- (a NULL page_id with full_automation triggers the coherence CHECK
  -- below on next UPDATE).
  page_id                  uuid REFERENCES pages(id) ON DELETE SET NULL,

  state                    text NOT NULL DEFAULT 'insufficient_data'
    CHECK (state IN (
      'active', 'healthy', 'insufficient_data', 'read_only_external'
    )),
  state_evaluated_at       timestamptz,
  state_reasons            jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Ads spend (last 30d, USD) cached on the row so the bulk-page
  -- selection screen (§7.4.1) can sort without a metrics_daily
  -- aggregate. Refreshed by the daily Ads sync.
  spend_30d_usd_cents      bigint NOT NULL DEFAULT 0
    CHECK (spend_30d_usd_cents >= 0),
  sessions_30d             integer NOT NULL DEFAULT 0
    CHECK (sessions_30d >= 0),

  core_offer               text,
  page_snapshot            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Active technical alert flags. Populated by the alert evaluator;
  -- the page browser surfaces them at the top of the row.
  active_technical_alerts  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Data reliability indicator (§9.3 v1.5 addition): green / amber / red
  -- recomputed on every metrics aggregation. Cached so the page browser
  -- doesn't have to recompute on every row render.
  data_reliability         text NOT NULL DEFAULT 'red'
    CHECK (data_reliability IN ('green', 'amber', 'red')),
  data_reliability_checks  jsonb NOT NULL DEFAULT '{}'::jsonb,

  version_lock             bigint NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at               timestamptz,
  deleted_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- §3.4 invariant: full_automation requires a Site Builder page row.
  CONSTRAINT opt_landing_pages_management_mode_coherent CHECK (
    management_mode = 'read_only'
    OR (management_mode = 'full_automation' AND page_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX opt_landing_pages_client_url_uniq
  ON opt_landing_pages (client_id, url)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_landing_pages_managed_idx
  ON opt_landing_pages (client_id, state)
  WHERE deleted_at IS NULL AND managed = true;

CREATE INDEX opt_landing_pages_page_idx
  ON opt_landing_pages (page_id)
  WHERE page_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE opt_landing_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_landing_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_landing_pages_read ON opt_landing_pages
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_landing_pages_write ON opt_landing_pages
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
