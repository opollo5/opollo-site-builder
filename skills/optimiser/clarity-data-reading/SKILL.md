# Skill — clarity-data-reading

Read Microsoft Clarity behaviour data into `opt_metrics_daily`.

## Inputs
- `client_id` — Opollo optimiser client.
- `opt_client_credentials.payload.api_token` for `source = 'clarity'`.

## Endpoint
`GET https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=3`

Headers: `Authorization: Bearer <api_token>`.

## Daily sync rules
- Pull `numOfDays=3` to recover from a missed tick.
- Match URLs to `opt_landing_pages.url`. Skip rows for unmatched URLs.
- One UPSERT per `(landing_page_id, metric_date, source='clarity', dimension)`. The Phase 1 sync uses no dimension breakdown; device split is GA4's job.

## Failure modes
- 401/403 → `CredentialAuthError("EXPIRED", ...)` and the credential's status flips to `expired`.
- Rate-limit (10/day per project) is well above Phase 1 cadence; no backoff needed.

## Spec
§4.2, Table 8.

## Pointers
- Implementation: `lib/optimiser/sync/clarity.ts`
- Cron: `/api/cron/optimiser-sync-clarity`
