# Service Health Monitoring

Opollo runs five external services it cannot fully self-host: bundle.social, Ideogram, SendGrid, Anthropic, and Supabase, plus Upstash Redis (hot cache). (Vercel is the platform itself; if Vercel is down the app is down.) This document defines the in-house monitoring system that detects when any of these degrades, fails, or has a billing issue, and notifies platform admins.

The goal is **observable, bounded failure** — when something breaks, an admin knows within minutes, and they know which service, what kind of failure, and what to do about it.

For services with graceful-degradation paths (Upstash Redis specifically), a failure is **logged and notified but does not break the user request** — the system falls through to a secondary layer.

---

## 1. What gets monitored

| Service | Failure modes detected | Detection method | Degrades gracefully? |
|---|---|---|---|
| **bundle.social** | 5xx from publish API; webhook delivery failures; OAuth rejections | Wrap publish calls; track webhook delivery; track 4xx auth responses separately from 4xx validation | No — publishing is a hard requirement |
| **Ideogram** | 5xx; timeouts; quota exhausted (429); auth failures (401/402) | Wrap image-gen calls | Partially — image-gen feature unavailable, rest of app works |
| **SendGrid** | Bounce rate spike; 5xx on send; auth failures | Wrap email send; track bounces from SendGrid webhook | Partially — emails queued for retry; Slack channel is failsafe |
| **Anthropic** | 5xx; timeouts; rate-limit exhaustion (429); auth failures | Wrap text-gen calls | Partially — AI assistant unavailable, manual editing still works |
| **Supabase** | Postgres connection failures; storage 5xx; auth API failures | Wrap critical query paths | No — DB outage = app outage |
| **Upstash Redis** | 5xx; timeout; auth failures | Wrap Redis client calls in try/catch | **Yes — falls through to Postgres cold cache** |
| **Vercel Cron** | Cron handler stale (heartbeat check); 5xx response from cron handler | Heartbeat table monitored by separate cron | No — scheduled publishes pile up if cron is dead |

"Payment failure" is detected as a special case of **auth failure** (401, 402, 403 responses), recorded separately from technical 5xx errors so the alert tells the admin "this looks like a billing issue, check the vendor dashboard."

---

## 2. Architecture

```
lib/platform/service-health/
├── monitor.ts            ← withHealthMonitoring() wrapper used by every external API call
├── classify.ts           ← maps HTTP status + error shape to event_type + severity
├── record.ts             ← writes to service_health_events table
├── notify.ts             ← sends alerts via SendGrid + optional Slack
├── digest.ts             ← daily summary generator
└── types.ts              ← shared TypeScript types

app/api/internal/cron/
├── health-check/         ← every 5 minutes — looks for unresolved 'down' events, sends notifications if not yet notified
├── health-digest/        ← daily 9am AEST — sends digest of all events from the last 24h
└── (publish-due, cleanup-cache, escalate-approvals — already documented)

app/(platform)/admin/system/health/
├── page.tsx              ← admin dashboard: current status of each service + recent events
└── components/
    ├── ServiceStatusGrid.tsx
    ├── EventTimeline.tsx
    └── BillingIssueDialog.tsx     ← manual "mark this service as having billing issue" flow
```

---

## 3. The `withHealthMonitoring` wrapper

Every external API call is wrapped:

```ts
// lib/social/publishing/bundle-social-client.ts
import { withHealthMonitoring } from 'lib/platform/service-health/monitor';

export async function publishToProfile(profileId: string, payload: PublishPayload) {
  return withHealthMonitoring(
    'bundle.social',                          // service name
    'publish',                                // operation name (for breakdown)
    async () => {
      const res = await fetch(`${BASE_URL}/post`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BUNDLE_SOCIAL_API_KEY}` },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new ExternalServiceError({
          status: res.status,
          body: await res.text(),
          retryable: res.status >= 500 || res.status === 429
        });
      }
      return res.json();
    }
  );
}
```

The wrapper:
1. Times the call.
2. On success: writes a `recovered` event if the service was previously `down`; otherwise no-op (success is the default).
3. On failure: classifies the error → records the event → propagates the error to the caller (so caller-level retry logic still works).
4. Aggregates: 3+ failures from the same service in a rolling 5-minute window flips it to `down`. A success after `down` flips back to `recovered`.

---

## 4. Event classification

`lib/platform/service-health/classify.ts` maps the raw error to an event type:

| HTTP status / error shape | event_type | severity |
|---|---|---|
| 5xx | `service_5xx` | warning until 3+ in 5min → critical |
| Network timeout / fetch error | `connection_failure` | warning until 3+ in 5min → critical |
| 401 (Unauthorized) | `auth_failure` | critical immediately — likely API key revoked |
| 402 (Payment Required) | `billing_failure` | critical immediately |
| 403 (Forbidden) | `auth_failure` | critical (could be permission revoked or billing) |
| 429 (Rate Limited) | `rate_limit` | info — expected, only escalates if persistent (>10 min) |
| Webhook signature mismatch | `webhook_auth_failure` | critical immediately (potential attack OR rotated secret) |
| 4xx validation error | NOT an event — caller's problem | n/a |

Aggregation: events of the same `(service_name, event_type)` within 5 minutes update an existing event rather than creating new ones. Counter increments, `last_seen_at` advances.

---

## 5. Notification channels

Two channels. Primary fails → secondary fires.

**Recipient discovery (DB-based, not env var):**

On each notification event, `notify.ts` queries:

```sql
SELECT DISTINCT u.email
FROM auth.users u
JOIN company_users cu ON cu.user_id = u.id
WHERE cu.role = 'platform_admin'
  AND u.email IS NOT NULL;
```

This returns the current set of platform admins. Adding/removing an admin is a database operation on `company_users` (already done via the existing role-management UI), not an env-var change.

**Primary: SendGrid email** to every email returned by the query above. Template includes service name, event type, severity, count, first/last seen times, and a link to the admin health dashboard (`https://app.opollo.com/admin/system/health`).

**Secondary: Slack** via `SLACK_WEBHOOK_URL_OPS` (optional). Fires when SendGrid send itself fails OR when severity is `critical`. If the env var is unset, this channel is skipped silently (system runs SendGrid-only).

**Tertiary failsafe: Sentry.** Every event is also captured in Sentry with tags (`service: bundle.social`, `severity: critical`). If both SendGrid and Slack are down, Sentry's own alerting (which uses different infrastructure) reaches you.

**Self-monitoring caveat:** Detecting that SendGrid is down requires not using SendGrid to notify. The `notify.ts` logic:
1. If service being reported = SendGrid, skip email channel entirely. Go straight to Slack + Sentry.
2. Same rule for Slack: if reporting on Slack (e.g. webhook returned 5xx), skip Slack channel.
3. Same for Upstash Redis: don't write to Redis to track Redis failures.

This is encoded in `notify.ts` — Claude Code will write the check.

---

## 6. Rate limiting the notifications

To prevent alert storms:
- Same `(service_name, event_type)` notifies at most once every 30 minutes.
- A `recovered` event always notifies, regardless of recent alerts.
- The daily digest summarises everything regardless of in-the-moment notification status.

The `notified_at` column on `service_health_events` tracks this. A health-check cron runs every 5 minutes and notifies for events that:
- Have severity `critical`
- Have `notified_at` either NULL or older than 30 minutes ago
- Are still unresolved (`resolved_at IS NULL`)

---

## 7. Database schema

Migration `0135_cron_infrastructure.sql` (see `migrations/`) creates two tables.

### `cron_heartbeats`

Tracks the last successful run of each cron job. The heartbeat-check cron compares to "now" and alerts if stale.

```sql
CREATE TABLE cron_heartbeats (
  job_name      text PRIMARY KEY,
  last_run_at   timestamptz NOT NULL,
  last_status   text NOT NULL CHECK (last_status IN ('ok', 'error')),
  last_error    jsonb,
  run_count     integer NOT NULL DEFAULT 0
);
```

Every cron handler writes to this on completion. Heartbeat-check cron:

```sql
SELECT job_name FROM cron_heartbeats
WHERE last_run_at < NOW() - INTERVAL '5 minutes'
   OR (job_name = 'publish-due' AND last_run_at < NOW() - INTERVAL '90 seconds');
```

Any rows returned → record a `cron_stale` event in `service_health_events`.

### `service_health_events`

```sql
CREATE TABLE service_health_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name    text NOT NULL,
  operation       text,                                          -- e.g. 'publish', 'send_email'
  event_type      text NOT NULL CHECK (event_type IN (
                    'service_5xx', 'connection_failure', 'auth_failure',
                    'billing_failure', 'rate_limit', 'webhook_auth_failure',
                    'cron_stale', 'recovered', 'manual_flag'
                  )),
  severity        text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at   timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at    timestamptz NOT NULL DEFAULT NOW(),
  resolved_at     timestamptz,
  notified_at     timestamptz,
  details         jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_by_user_id uuid REFERENCES auth.users(id)              -- NULL = system-detected; set for manual flags
);

CREATE INDEX idx_service_health_events_active
  ON service_health_events (service_name, event_type)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_service_health_events_recent
  ON service_health_events (last_seen_at DESC);
```

---

## 8. Manual billing-issue flag

Some payment failures arrive as email to the operator account, not as 402 responses. (Stripe charge fails silently; vendor sends an email; service still works for a few days; then it doesn't.)

The admin dashboard at `/admin/system/health` includes a "Flag service for review" button per service. Clicking opens a dialog:

```
Service: [bundle.social ▾]
Issue type: [Billing ▾ / Auth ▾ / Other ▾]
Notes: [free text]
[Submit]
```

Submission creates an event with `event_type = 'manual_flag'`, severity `critical`, `raised_by_user_id` set. Triggers notification to all admins (so other admins know about the flag). Stays unresolved until an admin marks it resolved.

This handles the "payment failed, vendor emailed me, I want to track it in Opollo" case.

---

## 9. Admin dashboard

`/admin/system/health` — gated to `role = 'platform_admin'`.

**Top of page: service status grid.** One card per monitored service. Card colour:
- 🟢 Green: no unresolved critical events in last 24h
- 🟡 Yellow: warning events present OR resolved critical events in last 6h
- 🔴 Red: unresolved critical event

Each card shows: service name, current status, last incident timestamp, "Flag for review" button.

**Below: event timeline.** Chronological list of events from the last 30 days. Each row: timestamp, service, operation, type, severity, count, resolved-state, "View details" expand.

**Right side: digest preview.** Read-only preview of what tomorrow's daily digest will look like, regenerated on page load.

---

## 10. Environment variables

```
SLACK_WEBHOOK_URL_OPS=                    # optional; second channel for critical events
```

That's the only health-system-specific env var, and it's optional. Admin recipients are discovered by DB query on each event — see §5. If `SLACK_WEBHOOK_URL_OPS` is unset, the secondary channel is skipped silently.

---

## 11. Build order placement

This system is built in PR B alongside the API surface, because the API handlers are the consumers of `withHealthMonitoring`. Specifically:

- `lib/platform/service-health/` modules (monitor, classify, record, notify, digest, types)
- Migration `0135_cron_infrastructure.sql`
- `/api/internal/cron/health-check` and `/api/internal/cron/health-digest` handlers
- `vercel.json` cron config
- `app/(platform)/admin/system/health/page.tsx` ships in a smaller follow-up PR after PR H — the monitoring backend ships in PR B, the UI ships separately to keep PR B bounded.

---

## 12. Definition of done for service health monitoring

- [ ] Every external API call site uses `withHealthMonitoring` (verifiable: `git grep` for `fetch(` in `lib/` returns nothing outside of wrapper code)
- [ ] `service_health_events` table receives events on simulated failures (unit tests with mocked 5xx responses)
- [ ] Notification fires to test SendGrid recipient on simulated critical event
- [ ] Slack notification fires when SendGrid is the failing service
- [ ] Rate limit: same event type re-firing within 30min does not re-notify
- [ ] Heartbeat-check cron detects a stale heartbeat (test by manually setting `last_run_at` to 10min ago)
- [ ] Manual flag flow creates an event, notifies, allows resolution
- [ ] Daily digest renders correctly with seeded events
- [ ] Admin dashboard route is gated to `platform_admin` only

When all nine boxes are ticked, the system is production-ready.
