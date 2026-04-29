# Skill — variant-generation

Generate an A/B test pair from an approved optimisation proposal (Phase 2 Slice 18). Produces two opt_variants rows — A (control, change set verbatim) and B (challenger, structurally distinct alternative) — and one opt_tests row in status `queued`.

## When this fires

POST `/api/optimiser/proposals/[id]/create-variant` with optional `{ traffic_split_percent: 1..99 }` body. Default split: 50.

The proposal must be in `approved` or `applied` status. Drafts / pending / rejected proposals are rejected with `CONTEXT_LOAD_FAILED`.

## Variant B — what makes it structurally distinct

The user-facing brief from §6 feature 8 says variants should differ meaningfully — not just copy tweaks. The variant generator's LLM call asks for one of:

- Different hero composition (centred vs left-aligned)
- Different CTA placement / verb / size
- Different form length (short vs long, single-step vs multi-step)
- Different proof-element layout (logos vs testimonial vs numbers)

Output JSON shape from the LLM:
```json
{
  "change_set": <object — same shape as input change_set>,
  "notes": "<one sentence describing the structural difference>"
}
```

Cost path: gated via `gateLlmCall(client_id, "variant_generation")` against the §4.6 monthly budget. Cost recorded in `opt_llm_usage` per call. Model: `claude-sonnet-4-6`, idempotency key `optimiser:variant-b:<proposal_id>` so a re-run during the 24h Anthropic cache window returns the same response without re-billing.

## Deterministic fallback

When the LLM call is blocked (budget exhausted) or fails (parse error / network), the generator falls back to one of three pre-defined twists, deterministically chosen from a hash of the proposal id:

1. `centred_hero_with_long_form`
2. `trust_first_above_offer`
3. `two_step_form_with_progress_indicator`

Each twist annotates the change set with a `_variant_b_twist` marker so the brief-runner has a known input to compose against. The fallback ensures testing isn't fully gated on LLM availability.

## What gets written

- One `briefs` + `brief_pages` + `brief_runs` triple per variant (M12/M13 schema). `brief_pages.output_mode = full_page` for hosted clients, `slice` for `client_slice`.
- One `opt_variants` row per variant in status `generating`, with `change_set` + `generation_notes`.
- One `opt_tests` row in status `queued` linking both variants. Activation (status → `running`) happens once both variants reach `ready` after generation completes.

## Idempotency

Brief idempotency key is `optimiser:variant:<proposal_id>:<A|B>`. Re-calling create-variant on the same proposal will trip the `briefs.upload_idempotency_key` UNIQUE — surfaced as a 500 on the second call. Phase 3 follow-up can add explicit "are there already variants for this proposal?" pre-check + return.

## Phase 1.5 defect note

`lib/optimiser/site-builder-bridge/submit-brief.ts` (Phase 1.5) selects `client.slug` but the column is `client_slug`. Slice 18's variant generator avoids reusing that helper and reads `client_slug` directly. Filing the underlying defect separately; not in scope for Phase 2 work.

## Pointers

- `lib/optimiser/variants/generator.ts:createVariantPair`
- `lib/optimiser/variants/activator.ts:activateTest`, `:markVariantReady`
- `lib/optimiser/variants/traffic-split.ts:buildTrafficSplitScript`
- API: `app/api/optimiser/proposals/[id]/create-variant/route.ts`
- Spec: §6 feature 8 (Testing engine), §12.3 (Phase 2 build order)
