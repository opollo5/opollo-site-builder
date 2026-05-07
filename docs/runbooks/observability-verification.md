# Observability verification runbook

Single-command health check for the four observability vendors wired in M10 (Sentry, Axiom, Langfuse, Upstash Redis). Hit the self-probe endpoint against any deployed environment, get a per-vendor ok/error envelope.

Use this:
- After every provisioning change (rotate a token, change a dataset).
- As the post-deploy smoke check when M10 or follow-up observability work merges.
- When something that should be reaching a vendor isn't showing up — it tells you whether the SDK even sees the env vars.

---

## The command

**Admin session (Vercel preview / prod with Supabase Auth on):**

```
curl -X POST \
  -H "Cookie: $(cat ~/.opollo-session-cookie)" \
  https://<host>/api/ops/self-probe | jq .
```

**Emergency key (no Supabase session required):**

```
curl -X POST \
  -H "X-Opollo-Emergency-Key: $OPOLLO_EMERGENCY_KEY" \
  https://<host>/api/ops/self-probe | jq .
```

The emergency-key path exists so verification works even when Supabase Auth is the thing being debugged. Keep the key in a password manager, not in shell history.

## Expected green response

```json
{
  "ok": true,
  "probe_id": "lxk3f9-a8b2c1",
  "elapsed_ms": 1432,
  "vendors": {
    "sentry":   { "ok": true, "details": { "eventId": "abc123def456..." } },
    "axiom":    { "ok": true, "details": { "dataset": "opollo-logs" } },
    "langfuse": { "ok": true, "details": { "traceId": "lf-trace-xyz..." } },
    "upstash":  { "ok": true, "details": { "roundTripMs": 34 } }
  },
  "timestamp": "2026-04-22T03:41:17.123Z"
}
```

HTTP status is 200 when every vendor passes; 502 when any returns ok: false. `probe_id` is unique per call — use it to find the specific event in each vendor's dashboard.

## Per-vendor troubleshooting

### Sentry — `ok: false`

**Common errors:**
- `"SENTRY_DSN not set"` → env var missing on this deployment. Check Vercel → Settings → Environment Variables. Trigger a redeploy after adding.
- `"Cannot find sentry.server.config.ts"` → the `instrumentation.ts` hook didn't load the config. Check the build output for the Sentry plugin's lines; re-verify `withSentryConfig` wraps `nextConfig` in `next.config.mjs`.
- Network timeout / 5xx from Sentry → transient. Retry the probe in 60s. If persistent, check the Sentry status page.

**Dashboard-side verification:**
Open https://sentry.io/organizations/<org>/issues/?query=probe_id%3A<probe_id> — the event should appear within 5-10 seconds of the probe returning. If the probe said ok but the event isn't visible, the likely cause is project-level filtering (inbound filters / allowlists). Check Sentry → Project Settings → Inbound Filters.

### Axiom — `ok: false`

**Common errors:**
- `"AXIOM_TOKEN or AXIOM_DATASET not set"` → one or both missing. The self-probe reports which one in the error text.
- SDK-level throw from `ax.ingest()` → rare, usually means malformed payload. The logger.ts transport wraps every record through the same `sanitize()` path as stdout, so this should match what you see in Vercel logs.

**Dashboard-side verification:**
Axiom → Datasets → `<AXIOM_DATASET>` → Stream view. Filter on `msg:"m10_self_probe_axiom"` and `probe_id:"<probe_id>"`. Records are typically visible within 5-30 seconds of ingest.

**If `ok: true` but data not visible:**
The self-probe only verifies the SDK call didn't throw, not that the record was indexed. Axiom's ingest is async — give it 30 seconds. Beyond that, check:
1. Dataset exists and is writable by this token (Axiom → Settings → API Tokens → the token's scopes).
2. Axiom status page for ingest delays.

### Langfuse — `ok: false`

**Common errors:**
- `"LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY not set"` → env vars missing. `LANGFUSE_HOST` defaults to `https://us.cloud.langfuse.com` so usually doesn't need to be set explicitly — but if your project is EU, set it explicitly to `https://cloud.langfuse.com`.
- `flushAsync()` timeout / network error → the Langfuse SDK batches events. `flushLangfuse()` in the probe awaits the in-flight batch; if Langfuse's ingest is slow, the probe may time out at 30s. Retry the probe; Langfuse is typically fast but has occasional ingest lag.

**Dashboard-side verification:**
Langfuse → Traces → search for the `traceId` from the response. The trace should appear within ~10 seconds of the probe returning. Filter on `metadata.source = self_probe` to see the full probe history across runs.

### Upstash Redis — `ok: false`

**Common errors:**
- `"UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN not set"` → env missing.
- `"round-trip read returned X, expected Y"` → the write succeeded but the read got a stale / wrong value. Most likely: another client wrote to the same key in the ~ms between our write and read. The probe key format `m10:self-probe:<probe_id>` is random per call, so collisions are improbable — if this happens, open an Upstash support ticket.
- HTTP 403 from Upstash → the token's database ACL doesn't include SET or GET. Check Upstash Console → Database → REST API → Token permissions.
- Network timeout → Upstash's REST edge is typically very fast (<50ms). Sustained timeouts suggest a regional outage; check Upstash status.

**Probe key retention:**
Keys are written with `EX 60` (1-minute TTL). No cleanup needed — they expire automatically. If you need to inspect a probe's key, do it within 60 seconds of the response.

## The endpoint's own failure modes

Returns 401 `UNAUTHORIZED` when:
- No admin session AND no emergency key present.
- Emergency key present but `OPOLLO_EMERGENCY_KEY` isn't set on this deployment (minimum length 32 chars enforced).
- Emergency key present but doesn't match.

Returns 502 when any vendor probe returned `ok: false`. Inspect the `vendors.<name>.error` field for the reason.

Returns 500 only on unexpected runtime errors — the individual vendor probes catch their own failures and return them as ok: false entries, so 500 at the envelope level is genuinely exceptional.

## Automation

For post-deploy verification:

```bash
#!/usr/bin/env bash
set -euo pipefail
URL="${1:-https://opollo-site-builder.vercel.app}"
KEY="${OPOLLO_EMERGENCY_KEY:?OPOLLO_EMERGENCY_KEY not set}"
response=$(curl -fsS -X POST \
  -H "X-Opollo-Emergency-Key: $KEY" \
  "$URL/api/ops/self-probe")
echo "$response" | jq .
ok=$(echo "$response" | jq -r '.ok')
[ "$ok" = "true" ]
```

Exit code is non-zero if any vendor returned `ok: false` or the endpoint returned non-2xx. Drop this into a GitHub Action or a cron job if you want continuous verification.

## When things are really broken

If the self-probe itself is unreachable (500 / can't-route / TLS error), the observability stack can't be the first thing you debug — verification depends on the app being healthy enough to serve the route.

1. `/api/health` — connectivity to Supabase + build info. If this is down, observability is downstream of a bigger problem.
2. Vercel deployment logs — did the last deploy succeed? Any function cold-start errors?
3. `next.config.mjs` — is `withSentryConfig` wrapping `nextConfig`? A broken Sentry wrap can kill every route, not just the probe.
