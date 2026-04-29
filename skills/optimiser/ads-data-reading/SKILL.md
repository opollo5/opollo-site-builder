# Skill — ads-data-reading

Read Google Ads data via GAQL for the Optimisation Engine.

## Inputs
- `client_id` (uuid) — Opollo optimiser client.
- The client's `opt_client_credentials` row for `source = 'google_ads'`
  (refresh token + customer_id), encrypted with AES-256-GCM via
  `lib/encryption.ts`.

## Phase 1 GAQL queries (Slice 7 ships the full set)
- **Campaigns** → `opt_campaigns`
  ```
  SELECT campaign.id, campaign.name, campaign.status,
         campaign.advertising_channel_type, campaign_budget.amount_micros
  FROM campaign WHERE campaign.status != 'REMOVED'
  ```
- **Ad groups** → `opt_ad_groups`
  ```
  SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id
  FROM ad_group WHERE ad_group.status != 'REMOVED'
  ```
- **Keywords** → `opt_keywords` (positive search-network keywords only)
  ```
  SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
         ad_group_criterion.keyword.match_type, ad_group_criterion.status,
         ad_group.id
  FROM ad_group_criterion
  WHERE ad_group_criterion.type = 'KEYWORD'
    AND ad_group_criterion.status != 'REMOVED'
  ```
- **Ads** → `opt_ads` (RSA headlines + descriptions + final URL)
  ```
  SELECT ad_group_ad.ad.id, ad_group_ad.ad.type,
         ad_group_ad.ad.responsive_search_ad.headlines,
         ad_group_ad.ad.responsive_search_ad.descriptions,
         ad_group_ad.ad.final_urls, ad_group_ad.status, ad_group.id
  FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'
  ```
- **Landing pages + 30d metrics** → `opt_landing_pages` (auto-creates rows
  with `managed=false` so the bulk-select screen surfaces them) + per-day
  rows in `opt_metrics_daily` (`source='google_ads'`):
  ```
  SELECT landing_page_view.unexpanded_final_url, segments.date,
         metrics.clicks, metrics.cost_micros, metrics.impressions,
         metrics.conversions, metrics.average_cpc
  FROM landing_page_view WHERE segments.date >= 'YYYY-MM-DD'  (30 days back)
  ```
- **Search terms** → aggregated top 30 per ad group in
  `opt_ad_groups.raw.top_search_terms` (sorted by impressions desc).
  Read by the alignment scorer's `intent_match` sub-score.
  ```
  SELECT search_term_view.search_term, ad_group.id,
         metrics.impressions, metrics.clicks, metrics.conversions
  FROM search_term_view WHERE segments.date >= 'YYYY-MM-DD'
  ```

## Endpoint
`POST https://googleads.googleapis.com/v17/customers/{customer_id}/googleAds:searchStream`

Required headers:
- `Authorization: Bearer <access_token>` (exchanged from the refresh token)
- `developer-token: <Opollo MCC developer token>` from `GOOGLE_ADS_DEVELOPER_TOKEN`
- `login-customer-id: <Opollo MCC id>` (optional, when calling on behalf of a managed account)

## Persistence rules
- All entity writes are idempotent UPSERTs:
  - `opt_campaigns`: `(client_id, external_id)`
  - `opt_ad_groups`: `(client_id, external_id)`
  - `opt_keywords`: `(ad_group_id, external_id)`
  - `opt_ads`: `(ad_group_id, external_id)`
- `opt_metrics_daily`: `(landing_page_id, metric_date, source, dimension_key, dimension_value)`.
- `opt_landing_pages` URL surface is auto-created on first sight; the
  `managed` flag stays operator-controlled (per §7.4).
- `opt_ad_groups.raw.top_search_terms` is rewritten on every sync — it's
  a snapshot, not an append log.
- Cost is converted from `cost_micros` (USD × 1,000,000) to
  `cost_usd_cents` (USD × 100) by integer divide-by-10,000.
- Asset-text extraction handles both legacy string-array and v17+
  `{ text }` / `{ asset_text }` shapes.
- On 401 / 403, throw `CredentialAuthError("EXPIRED", ...)` so the
  runner flips `opt_client_credentials.status` to `expired` and the
  §7.3 banner surfaces.

## Cadence
Daily, off-peak. The runner short-circuits if the credential row was
synced within the last hour. Phase 1.5 may add
`process.env.OPTIMISER_ADS_FORCE_SYNC=1` for staff-triggered immediate
runs; not shipping in Slice 7.

## Pointers
- Implementation: `lib/optimiser/sync/ads.ts`
- Cron: `/api/cron/optimiser-sync-ads` registered in `vercel.json`
- Spec: §4.1, Table 7
