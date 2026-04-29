# Skill — trust-gap (Phase 2 playbook)

§9.6.2 Phase 2 playbook. Fires when form-completion is low while engagement is high — a signal that visitors are reading the page but not converting because they don't trust the offer enough to fill in the form.

## Trigger
```json
{
  "all": [
    { "metric": "form_completion_rate",  "op": "lt", "value": 0.40 },
    { "metric": "avg_engagement_time_s", "op": "gt", "value": 60 },
    { "metric": "proof_near_cta",        "op": "eq", "value": false }
  ]
}
```

## Defaults
- Risk: low
- Effort: 1
- Seed impact: +4–8pp CR

## Fix template
Surface existing testimonials, certifications, or guarantees from the page's asset library next to the primary CTA. **Do not invent new claims** — §10 guardrails enforce this; the brief-runner's quality gates reject fabricated proof.

## Why
Visitors who scroll, read, and then bounce often need a final reassurance signal before submitting a form. Trust placement matters more than trust availability — if a testimonial exists below the fold but not next to the CTA, the visitor doesn't see it at decision time.

## Pointers
- Migration: `supabase/migrations/0058_optimiser_phase_2_playbooks.sql`
- Metric `proof_near_cta` populated by the page-content-analysis skill (extension lands when the page snapshot is enriched in a follow-up; Phase 2 default is `false`, so this playbook fires conservatively).
- Spec: §9.6.2, Table 24
