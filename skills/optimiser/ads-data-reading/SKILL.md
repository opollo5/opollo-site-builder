# Skill — ads-data-reading

Read Google Ads data via GAQL for the Optimisation Engine.

## Inputs
- `client_id` (uuid) — Opollo optimiser client.
- The client's `opt_client_credentials` row for `source = 'google_ads'`
  (refresh token + customer_id), encrypted with AES-256-GCM via
  `lib/encryption.ts`.

## Phase 1 GAQL queries
- `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`
- `SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED'`
- `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.id FROM ad_group_criterion WHERE ad_group_criterion.type = KEYWORD AND ad_group_criterion.status != 'REMOVED'`
- `SELECT ad_group_ad.ad.id, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, ad_group_ad.status, ad_group.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`
- `SELECT landing_page_view.unexpanded_final_url, segments.date, metrics.clicks, metrics.cost_micros, metrics.impressions, metrics.conversions FROM landing_page_view WHERE segments.date DURING LAST_30_DAYS`

## Endpoint
`POST https://googleads.googleapis.com/v17/customers/{customer_id}/googleAds:searchStream`

Required headers:
- `Authorization: Bearer <access_token>` (exchanged from the refresh token)
- `developer-token: <Opollo MCC developer token>` from `GOOGLE_ADS_DEVELOPER_TOKEN`
- `login-customer-id: <Opollo MCC id>` (optional, when calling on behalf of a managed account)

## Persistence rules
- All writes are idempotent UPSERTs keyed by `(client_id, external_id)` for entity tables, and by `(landing_page_id, metric_date, source, dimension_key, dimension_value)` for `opt_metrics_daily`.
- On 401 / 403, throw `CredentialAuthError("EXPIRED", ...)` so the runner flips `opt_client_credentials.status` to `expired` and the §7.3 banner surfaces.

## Cadence
Daily, off-peak. The runner short-circuits if the credential row was synced within the last hour. Phase 1.5 may add `process.env.OPTIMISER_ADS_FORCE_SYNC=1` for staff-triggered immediate runs; not shipping in Slice 2.

## Pointers
- Implementation: `lib/optimiser/sync/ads.ts`
- Cron: `/api/cron/optimiser-sync-ads` registered in `vercel.json`
- Spec: §4.1, Table 7
