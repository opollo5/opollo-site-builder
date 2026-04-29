-- 0058 — Optimiser Phase 2 Slice 20: seed Phase 2 playbooks.
-- Reference: docs/Optimisation_Engine_Spec_v1.5.docx §9.6.2, Table 24
-- (trust_gap, intent_mismatch, stale_social_proof) plus three
-- behaviour-driven trigger playbooks per §12.3 + §9.6 (rage clicks,
-- dead clicks, exit intent) feeding the existing proposal pipeline.
--
-- Six new opt_playbooks rows. category='content_fix' for all six —
-- they generate proposals through the same priority / expiry / review
-- flow as Phase 1 playbooks. The new metrics referenced in trigger
-- expressions (rage_clicks_per_session, dead_clicks_per_session,
-- quick_back_rate, search_intent_class, etc.) extend the metric bag
-- in lib/optimiser/playbook-execution.ts; the Slice 20 code change
-- adds those metrics to buildMetricBag.
--
-- Idempotent INSERT ... ON CONFLICT DO NOTHING so re-applying this
-- migration on a pre-seeded database is a no-op.

INSERT INTO opt_playbooks (
  id, name, description, category, phase,
  trigger, fix_template,
  default_risk_level, default_effort_bucket,
  seed_impact_min_pp, seed_impact_max_pp
) VALUES
  (
    'trust_gap',
    'Trust gap',
    'Form completion rate is low and engagement time is high but no proof element appears near the primary CTA — surface existing testimonials, certifications, or guarantees adjacent to the form.',
    'content_fix', 'phase_2',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'form_completion_rate',  'op', 'lt', 'value', 0.40),
        jsonb_build_object('metric', 'avg_engagement_time_s', 'op', 'gt', 'value', 60),
        jsonb_build_object('metric', 'proof_near_cta',        'op', 'eq', 'value', false)
      )
    ),
    'Surface existing testimonials, certifications, or guarantees from the page''s asset library next to the primary CTA. Do not invent new claims.',
    'low', 1, 4.0, 8.0
  ),
  (
    'intent_mismatch',
    'Intent mismatch',
    'Top search terms are informational while the page is transactional (or vice versa) — propose a new informational layer above the conversion section, or recommend a separate informational page.',
    'content_fix', 'phase_2',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'search_intent_class', 'op', 'eq', 'value', 'informational'),
        jsonb_build_object('metric', 'page_intent_class',   'op', 'eq', 'value', 'transactional')
      )
    ),
    'Add an informational layer (FAQ / explainer / comparison table) above the conversion section. Preserve the conversion below; surface educational content first.',
    'high', 4, 10.0, 20.0
  ),
  (
    'stale_social_proof',
    'Stale social proof',
    'Page has no testimonial or social-proof component within the first three viewports despite having proof elements available in the page asset library.',
    'content_fix', 'phase_2',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'testimonial_in_viewport_1_to_3', 'op', 'eq', 'value', false)
      )
    ),
    'Surface an existing testimonial component in viewport 2 or 3. Use existing testimonials from the page asset library only.',
    'low', 1, 3.0, 6.0
  ),
  -- Behaviour-driven trigger playbooks — fire from Clarity signals via
  -- the existing playbook-execution evaluator. Slice 20 adds the
  -- corresponding metric-bag fields.
  (
    'rage_click_hotspot',
    'Rage-click hotspot',
    'Rage-click rate per session exceeds the threshold — visitors are clicking aggressively on a non-interactive element. Investigate which element via Clarity, then propose a fix that either makes the element interactive or removes the misleading affordance.',
    'content_fix', 'phase_2',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'rage_clicks_per_session', 'op', 'gt', 'value', 0.05)
      )
    ),
    'Identify the rage-click target from Clarity heatmap data and propose a structural fix: either make the element clickable (when staff identify the element should be a CTA) or remove the misleading affordance (when staff identify it as decorative).',
    'medium', 2, 4.0, 9.0
  ),
  (
    'dead_click_pattern',
    'Dead-click pattern',
    'Dead-click rate per session indicates visitors clicking on elements that do nothing — likely broken CTAs, mis-styled buttons, or images that look interactive.',
    'content_fix', 'phase_2',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'dead_clicks_per_session', 'op', 'gt', 'value', 0.10)
      )
    ),
    'Locate the dead-click target via Clarity, propose a fix: route the click to the primary CTA destination, restyle the element to remove the interactive affordance, or remove the element entirely.',
    'medium', 2, 5.0, 10.0
  ),
  (
    'exit_intent_high',
    'High exit-intent timing',
    'Quick-back rate (visitors leaving within 10 seconds) is elevated — typical for above-the-fold mismatch with the ad copy or for slow LCP making the page feel broken on first paint.',
    'content_fix', 'phase_2',
    jsonb_build_object(
      'all', jsonb_build_array(
        jsonb_build_object('metric', 'quick_back_rate', 'op', 'gt', 'value', 0.40)
      )
    ),
    'Restate the ad''s top-spending keyword and offer in the H1 + subhead so above-the-fold matches the ad expectation. If LCP is also poor, escalate page_speed alert in parallel.',
    'medium', 1, 5.0, 12.0
  )
ON CONFLICT (id) DO NOTHING;
