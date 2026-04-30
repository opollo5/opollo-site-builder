-- 0061 — Optimiser Phase 3 Slice 22: opt_pattern_library.
-- Reference: docs/Optimisation_Engine_Spec_v1.5.docx §11.2 (cross-client
-- learning, consent-gated), §6 feature 10 (Phase 3 cross-client
-- learning), §12.4 (Phase 3 build order).
--
-- Anonymised cross-client patterns. Each row records a STRUCTURAL
-- observation across N consenting clients — never client-specific
-- content, copy, or testimonials. Per §11.2.3:
--
--   pattern_type:  "cta_position" / "form_field_count" / "hero_layout" / etc.
--   observation:   one-line structural description (no URLs / names)
--   sample_size_*: how many pages / ad groups / clients contributed
--   effect_pp_*:   observed CR uplift in percentage points + 95% CI
--   confidence:    "low" / "moderate" / "high" derived from sample size
--
-- The pattern library is read by the proposal generator (Slice 23) to
-- bias expected_impact ranges with cross-client priors. Patterns are
-- ONLY extracted from clients with cross_client_learning_consent=true
-- on opt_clients (existing column from Phase 1 migration 0031).
--
-- Hard schema-level safeguard: NO foreign keys to client / page /
-- proposal tables. The pattern library is anonymised by construction —
-- no row should carry data linkable back to a single client.

CREATE TABLE opt_pattern_library (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type             text NOT NULL,
  observation              text NOT NULL,
  variant_label            text NOT NULL,
  baseline_label           text NOT NULL,
  sample_size_pages        integer NOT NULL CHECK (sample_size_pages >= 0),
  sample_size_ad_groups    integer NOT NULL CHECK (sample_size_ad_groups >= 0),
  sample_size_clients      integer NOT NULL CHECK (sample_size_clients >= 0),
  sample_size_observations integer NOT NULL CHECK (sample_size_observations >= 0),
  effect_pp_mean           numeric(6, 3) NOT NULL,
  effect_pp_ci_low         numeric(6, 3) NOT NULL,
  effect_pp_ci_high        numeric(6, 3) NOT NULL,
  confidence               text NOT NULL DEFAULT 'low'
    CHECK (confidence IN ('low', 'moderate', 'high')),
  applies_to               jsonb,
  triggering_playbook_id   text REFERENCES opt_playbooks(id) ON DELETE SET NULL,
  last_extracted_at        timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX opt_pattern_library_uniq
  ON opt_pattern_library (
    pattern_type,
    variant_label,
    baseline_label,
    COALESCE(triggering_playbook_id, '')
  );

CREATE INDEX opt_pattern_library_playbook_idx
  ON opt_pattern_library (triggering_playbook_id, confidence DESC, sample_size_clients DESC)
  WHERE triggering_playbook_id IS NOT NULL;

CREATE INDEX opt_pattern_library_type_confidence_idx
  ON opt_pattern_library (pattern_type, confidence DESC);

ALTER TABLE opt_pattern_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_pattern_library
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_pattern_library_read ON opt_pattern_library
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));
