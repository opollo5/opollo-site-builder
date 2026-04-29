# Optimiser — credential provisioning runbook

This runbook walks an operator through provisioning every Opollo-wide credential the Optimiser module needs. Per-client credentials (Ads OAuth refresh tokens, GA4 property IDs, Clarity API tokens) are entered through the onboarding wizard at `/optimiser/onboarding/<client_id>` and don't need shell access.

After each section's "Set the env var" step, hit `/optimiser/diagnostics` (admin-only) and confirm the diagnostic flips from "env missing" to "env configured". The endpoint also reports per-client connector status — the truth source for whether a sync has actually run successfully.

## Source of truth

- **Code surface:** `lib/optimiser/diagnostics.ts:runDiagnostics`
- **UI surface:** `/optimiser/diagnostics` (admin role required)
- **Module spec:** `docs/Optimisation_Engine_Spec_v1.5.docx`

## 1. Google Ads (refresh-token OAuth + MCC developer token)

### What you need
1. **Opollo MCC developer token.** Apply once for the agency-level MCC at https://ads.google.com → Tools → API Center. Approval typically takes 24-48h. Store in `GOOGLE_ADS_DEVELOPER_TOKEN`.
2. **OAuth client.** Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application. Add `https://<deploy-host>/api/optimiser/oauth/ads/callback` to "Authorised redirect URIs" for each environment (production, preview, local dev).
3. **Client ID + secret** from the OAuth client → store in `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`.

### Set the env vars
Production / preview: Vercel project settings → Environment Variables. Local dev: `.env.local`.

```
GOOGLE_ADS_CLIENT_ID=<from oauth client>
GOOGLE_ADS_CLIENT_SECRET=<from oauth client>
GOOGLE_ADS_DEVELOPER_TOKEN=<from MCC>
```

### Verify
1. `/optimiser/diagnostics` → google_ads section reports `env configured`.
2. Open `/optimiser/onboarding/<a-client-id>` → step 2 → "Sign in with Google" should redirect to `accounts.google.com`. If it redirects back with `error=ads_oauth_not_configured`, the env vars haven't reached the runtime.
3. After OAuth, paste the customer_id and click Verify. The verifier calls `searchStream` with `LIMIT 1` against the customer; ≥ 1 active campaign → green.

### Operational notes
- The developer token covers all Opollo-managed Ads accounts (standard MCC pattern). One token, many clients.
- Refresh tokens are stored encrypted (AES-256-GCM via `OPOLLO_MASTER_KEY`) in `opt_client_credentials`. Rotation runbook lives in `docs/RUNBOOK.md` → "Master key rotation" — same key, same rotation path.

## 2. GA4 (refresh-token OAuth)

### What you need
1. **OAuth client.** Same Google Cloud project as the Ads OAuth client (or a separate one — both work). The optimiser accepts either `GA4_CLIENT_ID`/`_SECRET` or `GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` as a fallback so a single shared client can drive both flows.
2. Enable **Google Analytics Data API v1beta** for the Cloud project (Console → Library → search "analyticsdata").
3. Add `https://<deploy-host>/api/optimiser/oauth/ga4/callback` to the OAuth client's "Authorised redirect URIs".

### Set the env vars
```
GA4_CLIENT_ID=<from oauth client>
GA4_CLIENT_SECRET=<from oauth client>
```
Or, if reusing the Ads OAuth client:
```
GOOGLE_OAUTH_CLIENT_ID=<shared>
GOOGLE_OAUTH_CLIENT_SECRET=<shared>
```

### Verify
1. `/optimiser/diagnostics` → ga4 section reports `env configured`.
2. Open `/optimiser/onboarding/<a-client-id>` → step 4 → "Sign in with Google" → consent → enter property_id → "Verify". The verifier runs a 7-day `runReport` with `sessions` + `conversions` metrics; ≥ 1 row → green. Zero rows → "no rows" warning. Zero conversions but rows → "GA4 has no conversions configured" soft warning (not blocking).

## 3. Microsoft Clarity (per-client API token; no Opollo-wide env)

Clarity is the only Phase 1 source that uses per-project tokens. There is no Opollo-wide env var — the operator copies each client's project token into the onboarding wizard step 3.

### Get the token
For each client's Clarity project: Clarity dashboard → Settings → Data Export. Generate a project API token. Copy + paste into `/optimiser/onboarding/<client_id>` step 3.

### Snippet install
The wizard's step 3 also displays the Clarity JS snippet. Two options:
1. Engineering injects via the Site Builder's WordPress connector (preferred for Site-Builder-managed sites).
2. Send the client an email with the snippet to add manually (template in the wizard).

### Verify
Click "Verify install" — the verifier calls Clarity's `project-live-insights` endpoint expecting at least one session in the last 24h. If zero sessions, the wizard shows "Waiting for first Clarity session." This is normal until the snippet has been live for ~10 minutes of real traffic.

## 4. PageSpeed Insights (free-tier API key)

### What you need
1. Google Cloud Console → APIs & Services → Library → enable **PageSpeed Insights API**.
2. Credentials → Create credentials → API key → restrict to PageSpeed Insights API + (optionally) HTTP referrer match for `*.opollo.com`.

### Set the env var
```
PAGESPEED_API_KEY=<from credentials>
```

### Verify
- `/optimiser/diagnostics` → pagespeed section reports `env configured`.
- Wait for the next `/api/cron/optimiser-sync-pagespeed` tick (Mondays 06:00 UTC by default — see `vercel.json`). Or call the endpoint manually with the cron secret for an immediate run.
- After a tick, `/optimiser` page browser shows LCP / mobile speed metrics on rows.

PSI quota: 25,000 queries/day on the free tier. Phase 1 needs much less (one query per managed page per week × 2 strategies).

## 5. Anthropic (LLM hybrid alignment scoring + brief construction in 1.5)

The optimiser shares the existing `ANTHROPIC_API_KEY`. Documented in this file's `.env.local.example`. No additional setup beyond the existing one.

### Verify
- `/optimiser/diagnostics` → anthropic section reports `env configured`.
- The LLM hybrid pass for `ad_to_page_match` and `intent_match` runs on every score-pages cron tick. Recent calls land in `opt_llm_usage`; the diagnostic doesn't surface that table directly today (Phase 1.5 will add a per-client cost panel).

## 6. Email transport (TBD per spec §9.11.4)

Phase 1 ships a no-op + log_only fallback. When the operator chooses a provider:

```
OPTIMISER_EMAIL_PROVIDER=sendgrid|postmark|resend
```

Each provider needs its own API key env var; that lands in a follow-up PR alongside the chosen provider's SDK adoption. Until then, digests render correctly but are not sent — the recipient + subject + byte-count appear in the logs.

## 7. Cron secret + master key (already provisioned for the rest of the codebase)

The optimiser reuses the existing `CRON_SECRET` and `OPOLLO_MASTER_KEY`. If either is unset, `/optimiser/diagnostics` flags it red — the optimiser will not function without both.

## What "ready to onboard a real client" looks like

`/optimiser/diagnostics` should report:
- Module: schema reachable (green), master key + cron secret set (green), email provider set or `noop` if intentional
- Sources: every section showing `env configured`. `connected clients = 0` is expected before the first onboarding completes.

When the first client onboards, the per-source `connected_clients` count increments and `last_successful_sync_at` populates within 24h of onboarding completion.
