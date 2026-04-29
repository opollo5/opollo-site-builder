# Skill — intent-mismatch (Phase 2 playbook)

§9.6.2 Phase 2 playbook. Fires when search-term intent class doesn't match the page's intent class.

## Trigger
```json
{
  "all": [
    { "metric": "search_intent_class", "op": "eq", "value": "informational" },
    { "metric": "page_intent_class",   "op": "eq", "value": "transactional" }
  ]
}
```

## Defaults
- Risk: high (changes the page's purpose, not just its copy)
- Effort: 4
- Seed impact: +10–20pp CR (highly variable per spec Table 22)

## Fix template
Add an informational layer (FAQ / explainer / comparison table) above the conversion section. Preserve the conversion below; surface educational content first so the visitor's "I want to learn" mode is satisfied before being asked to convert.

Alternative for severe mismatches: propose a separate informational page entirely. That decision goes to the operator via the high-risk approval flow.

## Intent classification
- `search_intent_class` — derived from the alignment scoring system's intent_match LLM call (§8 / Slice 8). Inputs: top search terms from `opt_ad_groups.raw.top_search_terms`.
- `page_intent_class` — heuristic: page with prominent form + transactional CTA verb = transactional; long-form content + few/no form fields = informational.

Both are stored on `opt_landing_pages.page_snapshot` or computed at evaluation time. Phase 2 default is `unknown` (which never satisfies the trigger's `eq 'informational'` / `eq 'transactional'` conditions), so this playbook fires conservatively until the classifier surfaces them.

## Why
Sending an informational searcher to a transactional page is one of the highest-cost mismatches in paid acquisition: high spend, low CR. The fix is structural, not copy-level.

## Pointers
- Migration: `supabase/migrations/0058_optimiser_phase_2_playbooks.sql`
- Spec: §9.6.2, Table 24, §8.1 intent_match sub-score
