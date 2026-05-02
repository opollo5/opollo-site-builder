-- 0069 — Optimiser: opt_clients (Slice 1 of feat/optimiser).
-- Reference: docs/Optimisation_Engine_Spec_v1.5.docx §5.1 + §3.6 + §4.6 + §11.2.
--
-- Renumbered from 0031 → 0069 to resolve a version-prefix collision with
-- 0031_email_log.sql (PR #286). supabase_migrations.schema_migrations
-- enforces UNIQUE on the version column, so two files sharing prefix 0031
-- meant `supabase db push` succeeded for whichever file ran first and
-- silently failed (or partially applied) the other. On environments where
-- the original 0031_optimiser_clients.sql had already created opt_clients
-- without a tracking row, recover by triggering deploy-migrations.yml with
-- `repair_versions_applied=0069` — the workflow runs
-- `supabase migration repair --status applied 0069 --linked` before
-- db push, marking 0069 applied without re-running the CREATE TABLE.
-- Fresh environments apply this file normally as version 0069.
--
-- Design decisions encoded here:
--
-- 1. One row per client account on the engine. Distinct from sites — a
--    single agency client may map to many sites, but the engine's billing
--    surface (LLM budgets), consent flags (cross-client learning), and
--    hosting decision are all client-level, not site-level.
--
-- 2. cross_client_learning_consent defaults FALSE. Phase 3 pattern library
--    only reads / writes from clients with TRUE here. Spec §11.2.2 makes
--    this an opt-in gated on MSA wording — never flip the default.
--
-- 3. llm_monthly_budget_usd defaults 50. Spec §4.6. Hard cutoff at 100% of
--    this; soft warning at 75%. Per-client overridable.
--
-- 4. hosting_mode default 'opollo_subdomain' per the v1.4 hosting decision
--    (§3.6). Three legal values; CHECK rather than ENUM so Phase 2/3
--    additions (e.g. cloudfront edge) don't require a type ALTER.
--
-- 5. staged_rollout_config JSONB seeded with the §12.2.1 defaults so a
--    Phase 1.5 reader can fall back to these without a NULL check. The
--    JSONB shape is deliberately flat — every Phase 1.5 reader can pick
--    out the keys it needs without traversing nested structure.
--
-- 6. Audit columns + soft-delete per docs/DATA_CONVENTIONS.md. version_lock
--    so Phase 1.5 brief construction can detect concurrent staff edits.

CREATE TABLE opt_clients (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                            text NOT NULL,
  primary_contact_email           text,

  cross_client_learning_consent   boolean NOT NULL DEFAULT false,
  llm_monthly_budget_usd          integer NOT NULL DEFAULT 50
    CHECK (llm_monthly_budget_usd >= 0),

  hosting_mode                    text NOT NULL DEFAULT 'opollo_subdomain'
    CHECK (hosting_mode IN ('opollo_subdomain', 'opollo_cname', 'client_slice')),
  hosting_cname_host              text,
  client_slug                     text NOT NULL,

  -- §12.2.1 defaults baked in. Phase 1.5 readers fall back to these
  -- without a NULL branch.
  staged_rollout_config           jsonb NOT NULL DEFAULT jsonb_build_object(
    'initial_traffic_split_percent', 20,
    'minimum_sessions', 300,
    'minimum_conversions', 10,
    'minimum_time_hours', 48,
    'cr_drop_rollback_pct', 15,
    'cr_drop_significance', 0.90,
    'bounce_spike_rollback_pct', 25,
    'error_spike_rollback_rate', 0.01,
    'maximum_window_days', 7
  ),

  -- §9.4.1 confidence formula calibration knobs, per-client overridable.
  confidence_overrides            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- §9.5 minimum data thresholds, per-client overridable.
  data_threshold_overrides        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Onboarding completion timestamp drives §9.11.5 accelerated email
  -- cadence (first 30 days twice-weekly + weekly). NULL = onboarding
  -- not yet complete.
  onboarded_at                    timestamptz,

  version_lock                    bigint NOT NULL DEFAULT 1
    CHECK (version_lock >= 1),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  created_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at                      timestamptz,
  deleted_by                      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX opt_clients_slug_active_uniq
  ON opt_clients (client_slug)
  WHERE deleted_at IS NULL;

CREATE INDEX opt_clients_onboarded_at_idx
  ON opt_clients (onboarded_at)
  WHERE deleted_at IS NULL AND onboarded_at IS NOT NULL;

ALTER TABLE opt_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_clients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Optimiser is a staff-only surface. Same role matrix as M2b: read for
-- all three roles, write for admin + operator only. Viewers see the
-- dashboards but can't modify client config.
CREATE POLICY opt_clients_read ON opt_clients
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_clients_write ON opt_clients
  FOR ALL TO authenticated
  USING      (public.auth_role() IN ('admin', 'operator'))
  WITH CHECK (public.auth_role() IN ('admin', 'operator'));
