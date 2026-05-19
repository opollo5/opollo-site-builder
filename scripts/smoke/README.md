# Smoke Tests — Layer 7 Live Probes

Real HTTP probes against a live Opollo deployment. Never run in CI — only post-deploy or on demand.

## Available scripts

| Script | What it tests | Cost |
|---|---|---|
| `npm run smoke:composer` | Social composer draft create/fetch/delete | $0 |
| `npm run smoke:cap` | CAP subscription check + generation | ~$0.20–$0.50 per run |

## Required env vars

### Both scripts

| Var | Notes |
|---|---|
| `SMOKE_BASE_URL` | Defaults to `https://app.opollo.com` |
| `SMOKE_SESSION_COOKIE` | `session_token=<value>` cookie from a logged-in session |
| `SMOKE_TEST_COMPANY_ID` | UUID of the test company |

### composer.smoke.ts only

| Var | Notes |
|---|---|
| `SMOKE_TEST_CONNECTION_ID` | UUID of a live social connection for the test company |

### cap.smoke.ts only

| Var | Notes |
|---|---|
| `SMOKE_CAP_CAMPAIGN_ID` | UUID of a draft CAP campaign to regenerate |
| `SMOKE_CAP_SKIP_GENERATION` | Set to `1` to skip AI calls (auth + shape checks only, $0) |

## Budget cap

A cumulative `$5` cap protects against runaway smoke test costs. The budget is tracked in `scripts/smoke/output/budget.json` (gitignored).

To check remaining: `node -e "const b = require('./scripts/smoke/output/budget.json'); console.log('Remaining: $' + (5 - b.totalSpent).toFixed(2))"`.

To reset: delete `scripts/smoke/output/budget.json`.

## Output

Each run writes a JSON report to `scripts/smoke/output/{script}-smoke-{timestamp}.json`. The directory is gitignored.

## Example

```sh
SMOKE_SESSION_COOKIE="session_token=eyJ..." \
SMOKE_TEST_COMPANY_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" \
SMOKE_TEST_CONNECTION_ID="yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy" \
npm run smoke:composer
```
