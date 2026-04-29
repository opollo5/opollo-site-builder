# Skill — ga4-data-reading

Read Google Analytics 4 page-level metrics into `opt_metrics_daily`.

## Inputs
- `client_id`
- `opt_client_credentials.payload`:
  - `refresh_token` — OAuth refresh token
  - `property_id` — GA4 property id
  - (Phase 2) `service_account_json` — alternative auth path

## Endpoint
`POST https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport`

Headers: `Authorization: Bearer <access_token>` (exchanged from the refresh token via `https://oauth2.googleapis.com/token`).

## Phase 1 report shape
```json
{
  "dateRanges": [{ "startDate": "2daysAgo", "endDate": "today" }],
  "dimensions": [
    { "name": "pagePath" },
    { "name": "deviceCategory" },
    { "name": "date" }
  ],
  "metrics": [
    { "name": "sessions" },
    { "name": "totalUsers" },
    { "name": "engagementRate" },
    { "name": "averageSessionDuration" },
    { "name": "bounceRate" },
    { "name": "conversions" }
  ]
}
```

`pagePath` is joined to `opt_landing_pages.url` after combining with the
client's onboarded base URL (stored on `opt_client_credentials.external_account_label`).

## Persistence
Each row → UPSERT into `opt_metrics_daily` with `dimension_key='device'`, `dimension_value=<deviceCategory>`. No "all" rollup row in Phase 1; the page-browser aggregator computes per-device totals by SUM().

## Failure modes
- 401/403 → `CredentialAuthError("EXPIRED", ...)`.
- Empty rows array → no-op (often genuine — small clients with little traffic).

## Spec
§4.3, Table 9.

## Pointers
- Implementation: `lib/optimiser/sync/ga4.ts`
- Cron: `/api/cron/optimiser-sync-ga4`
