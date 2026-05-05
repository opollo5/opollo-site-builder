# Skill — pagespeed-reading

Read Google PageSpeed Insights Core Web Vitals into `opt_metrics_daily`.

## Inputs
- `client_id`
- `process.env.PSI_API_KEY` — single Opollo-wide free-tier key.

PSI is the only Phase 1 source that does not use per-client credentials. The credential-aware sync runner is bypassed; the cron iterates `opt_clients` directly.

## Endpoint
`GET https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?url=<page_url>&strategy=mobile|desktop&category=performance&key=<api_key>`

## Cadence
Weekly per landing page. Per-client implementation skips a page if a PSI row exists in the last 6 days. Phase 1 fires both `mobile` and `desktop` strategies per page.

## Persisted metrics
- `lcp_ms` — Largest Contentful Paint (numericValue)
- `inp_ms` — Interaction to Next Paint
- `cls` — Cumulative Layout Shift
- `performance_score` — 0–100
- `mobile_speed_score` — copy of `performance_score` for `strategy=mobile`

`opt_metrics_daily` row uses `dimension_key='strategy'`, `dimension_value='mobile'|'desktop'`.

## Quota
25,000/day on the free tier. Phase 1 runs ≪ 1,000/day even for fleets of 100s of pages.

## Failure modes
- Best-effort. Per-page failure is swallowed; the next weekly tick retries.

## Spec
§4.4, Table 10.

## Pointers
- Implementation: `lib/optimiser/sync/pagespeed.ts`
- Cron: `/api/cron/optimiser-sync-pagespeed`
