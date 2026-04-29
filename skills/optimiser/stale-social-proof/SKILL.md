# Skill — stale-social-proof (Phase 2 playbook)

§9.6.2 Phase 2 playbook. Fires when the page has no testimonial component within the first three viewports despite the asset library having testimonials available.

## Trigger
```json
{
  "all": [
    { "metric": "testimonial_in_viewport_1_to_3", "op": "eq", "value": false }
  ]
}
```

## Defaults
- Risk: low
- Effort: 1
- Seed impact: +3–6pp CR

## Fix template
Surface an existing testimonial component in viewport 2 or 3. **Use existing testimonials only** — §10 guardrails forbid fabricating proof.

## Why
Industry research consistently shows social proof in the first three viewports (versus only at the bottom of long pages) lifts CR. A page that has perfectly good testimonials in its asset library but renders them only at the bottom is a low-risk, fast win.

## Detection
`testimonial_in_viewport_1_to_3` is detected by the page-content-analysis skill from the rendered page snapshot — looking for `<section data-opollo>` blocks tagged with a testimonial component class within the first ~2400px of body content. Phase 2 default is `false`, so the playbook fires conservatively until the detector is fully wired.

## Pointers
- Migration: `supabase/migrations/0058_optimiser_phase_2_playbooks.sql`
- Spec: §9.6.2, Table 24
