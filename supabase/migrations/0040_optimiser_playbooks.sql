-- 0040 — Optimiser: opt_playbooks.
-- Reference: spec §9.6 (playbook structure), §9.6.1 (Phase 1 set),
-- §9.6.3 (technical alerts), §9.4.2 (seed_impact_range).
--
-- Each row defines one optimisation playbook: trigger condition,
-- fix template, default risk + effort, seed impact range. Phase 1
-- ships with five content-fix playbooks + three technical-alert
-- playbooks. Phase 2 set is added by data-migration in a future slice.
--
-- Seeding lives in this migration so the Phase 1 set is reproducible
-- on a fresh DB (CI, local dev, prod cold-start) without a separate
-- "seed" step. Each row's id is a stable text key — staff and code
-- both reference playbooks by id, never by uuid.

CREATE TABLE opt_playbooks (
  id                       text PRIMARY KEY,
  name                     text NOT NULL,
  description              text NOT NULL,

  -- 'content_fix' generates a proposal; 'technical_alert' surfaces a
  -- non-approvable banner per §9.6.3.
  category                 text NOT NULL
    CHECK (category IN ('content_fix', 'technical_alert')),

  -- 'phase_1' / 'phase_2'. New phases added by ALTER CHECK on a future
  -- migration when Phase 2 ships.
  phase                    text NOT NULL DEFAULT 'phase_1'
    CHECK (phase IN ('phase_1', 'phase_2', 'phase_3')),

  -- Structured trigger conditions evaluated by the playbook-execution
  -- skill. Shape: { "all": [{...}, ...] } / { "any": [...] }. Slice 5
  -- pins the schema; this column is the storage.
  trigger                  jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- LLM prompt template that, given the trigger evidence, produces the
  -- structured change set. Free text; the proposal-generation skill
  -- substitutes evidence into placeholders.
  fix_template             text,

  default_risk_level       text NOT NULL DEFAULT 'medium'
    CHECK (default_risk_level IN ('low', 'medium', 'high')),
  default_effort_bucket    integer NOT NULL DEFAULT 1
    CHECK (default_effort_bucket IN (1, 2, 4)),

  -- Range ([min_pp, max_pp]) of CR uplift in percentage points the
  -- playbook seeds before any A/B calibration (§9.4.2).
  seed_impact_min_pp       numeric(6, 3) NOT NULL DEFAULT 0,
  seed_impact_max_pp       numeric(6, 3) NOT NULL DEFAULT 0,
    CHECK (seed_impact_max_pp >= seed_impact_min_pp),

  -- Page-type filter (e.g. only run on landing-shape pages). NULL = any.
  applies_to               jsonb,

  -- Globally enabled / disabled — staff can disable a playbook fleet-
  -- wide via admin tools (Phase 2). Per-client suppression lives in
  -- opt_client_memory.
  enabled                  boolean NOT NULL DEFAULT true,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE opt_playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON opt_playbooks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY opt_playbooks_read ON opt_playbooks
  FOR SELECT TO authenticated
  USING (public.auth_role() IN ('admin', 'operator', 'viewer'));

CREATE POLICY opt_playbooks_write ON opt_playbooks
  FOR ALL TO authenticated
  USING      (public.auth_role() = 'admin')
  WITH CHECK (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Phase 1 seed — §9.6.1.
-- ids are stable strings; trigger / fix_template detail is filled in
-- Slice 5 when the playbook-execution skill lands. Defaults shipped here
-- are the §9.6.1 / Table 23 / Table 25 columns: name, risk, effort,
-- seed impact range.
-- ---------------------------------------------------------------------------

INSERT INTO opt_playbooks (
  id, name, description, category, phase,
  trigger, fix_template,
  default_risk_level, default_effort_bucket,
  seed_impact_min_pp, seed_impact_max_pp
) VALUES
  (
    'message_mismatch',
    'Message mismatch',
    'Rewrite H1 + subheadline to match the top-spending keyword and the top-performing ad headline.',
    'content_fix', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'alignment_score',  'op', 'lt', 'value', 60),
        jsonb_build_object('metric', 'bounce_rate',      'op', 'gt', 'value', 0.65)
      )
    ),
    'Rewrite H1 and subheadline to align landing-page hero with the highest-spend keyword and best-performing ad headline. Preserve the core offer.',
    'medium', 1, 5.0, 10.0
  ),
  (
    'weak_above_the_fold',
    'Weak above-the-fold',
    'Move primary CTA to viewport 1 + add one trust signal above the fold.',
    'content_fix', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'avg_scroll_depth_desktop', 'op', 'lt', 'value', 0.30),
        jsonb_build_object('metric', 'cta_above_fold',           'op', 'eq', 'value', false)
      )
    ),
    'Move the primary CTA into viewport 1 and surface one trust signal above the fold. Preserve below-fold layout.',
    'low', 1, 5.0, 8.0
  ),
  (
    'form_friction',
    'Form friction',
    'Reduce form fields to ≤ 5, surface trust signals adjacent to form, restate offer at form top.',
    'content_fix', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'form_starts',          'op', 'gt', 'value', 50),
        jsonb_build_object('metric', 'form_completion_rate', 'op', 'lt', 'value', 0.40)
      )
    ),
    'Cut the form to ≤ 5 fields, place trust signals adjacent to it, restate the offer above the first input.',
    'medium', 2, 7.0, 12.0
  ),
  (
    'cta_verb_mismatch',
    'CTA verb mismatch',
    'Align landing page CTA verb to match the ad CTA verb.',
    'content_fix', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'cta_verb_match', 'op', 'eq', 'value', false)
      )
    ),
    'Update the primary CTA verb to match the ad''s CTA verb. No other copy change.',
    'low', 1, 2.0, 5.0
  ),
  (
    'offer_clarity',
    'Offer clarity',
    'Restate the core offer above the fold in one sentence; preserve below-fold detail.',
    'content_fix', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'avg_scroll_depth',     'op', 'gt', 'value', 0.60),
        jsonb_build_object('metric', 'conversion_rate',      'op', 'lt', 'value', 0.015),
        jsonb_build_object('metric', 'offer_above_fold',     'op', 'eq', 'value', false)
      )
    ),
    'Restate the core offer above the fold in a single sentence. Keep all below-fold detail in place.',
    'low', 1, 4.0, 9.0
  ),
  (
    'tech_page_speed',
    'Page speed',
    'Page has Core Web Vitals issues. Optimisation will not fix this — escalate to dev.',
    'technical_alert', 'phase_1',
    jsonb_build_object(
      'any', jsonb_build_array(
        jsonb_build_object('metric', 'lcp_ms',            'op', 'gt', 'value', 2500),
        jsonb_build_object('metric', 'mobile_speed_score', 'op', 'lt', 'value', 50)
      )
    ),
    NULL,
    'low', 1, 0, 0
  ),
  (
    'tech_tracking_broken',
    'Conversion tracking broken',
    'Ads reports clicks but zero conversions for ≥ 14 days on a page with > 200 sessions.',
    'technical_alert', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'sessions_14d',     'op', 'gt', 'value', 200),
        jsonb_build_object('metric', 'conversions_14d',  'op', 'eq', 'value', 0),
        jsonb_build_object('metric', 'clicks_14d',       'op', 'gt', 'value', 0)
      )
    ),
    NULL,
    'low', 1, 0, 0
  ),
  (
    'tech_mobile_failure',
    'Mobile-only failure',
    'Mobile experience underperforming desktop. Likely technical issue (form, layout, speed).',
    'technical_alert', 'phase_1',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'mobile_cr_vs_desktop_ratio', 'op', 'lt', 'value', 0.25)
      )
    ),
    NULL,
    'low', 1, 0, 0
  );
