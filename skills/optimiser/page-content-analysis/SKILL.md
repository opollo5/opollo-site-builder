# Skill — page-content-analysis

Extract H1, H2s, primary CTA, hero excerpt, form metadata, and offer/CTA above-fold heuristics from rendered page HTML.

## Inputs
- `url` (string)
- `html` (string — typically server-rendered output)

## Output (`PageSnapshot`)
- `title`, `h1`, `h2s[]`
- `primary_cta: { verb, text } | null`
- `hero_excerpt: string | null` — first 600 chars of body text
- `has_form: boolean`, `form_field_count: number`
- `offer_above_fold: boolean` — heuristic match for "free consult / book demo / save N% / guarantee" in head copy
- `cta_above_fold: boolean` — primary CTA appears in first 1200 chars

## Phase 1 heuristics
Phase 1 ships fast regex-based parsing. Works for static / server-rendered pages (Site-Builder-managed pages all qualify). Pages with heavy client-side rendering may return partial results — staff see this as an `offer not stated above fold` reason in the playbook trigger output, not a hard failure.

## When to upgrade
A real DOM parser (e.g. cheerio) can be dropped in if:
- ≥ 20% of fetches return an empty H1 or hero excerpt for client-rendered targets
- An LLM augmentation pass for offer detection becomes worth the cost

The function signature stays stable; replacing the regex layer is one file.

## Caller responsibility
Caller fetches the URL with the right headers (`User-Agent: Opollo-Optimiser/1.0`) and handles HTTP errors. `analyseHtml` assumes a 200 response body.

## Spec
§8 (alignment scoring inputs), §9.1 (proposal current snapshot), §9.6.1 (playbook trigger inputs).

## Pointers
- `lib/optimiser/page-content-analysis.ts:analyseHtml`
- Caller: `lib/optimiser/score-pages-job.ts`
