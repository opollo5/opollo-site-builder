# Dedup-or-persist bug-pattern audit

**Author:** Drafted 2026-05-30 from a focused read of `lib/social/`, `lib/image/`, `lib/cap/`, `app/api/cron/`, `app/api/internal/cron/`, `lib/platform/notifications/`, `lib/platform/service-health/`, and adjacent files. Read-only; no code changes.

**Motivating PRs:** #1132, #1141, #1143.

## The pattern (three sub-shapes)

| Shape | Description | Canonical fix |
|---|---|---|
| **A** | State held in a JS `Map` / `Set` / `let` / module-level variable that should be DB-backed. Vercel cold-starts wipe it; the state stops being observed across process boundaries. | Move to a DB row queried fresh on every invocation (PR #1132). |
| **B** | A dedup query keyed on too few fields (events for distinct entities collide on the same row) **or** a dedup window that doesn't match the event's semantics (latched events shouldn't use a bursty window). | Add the missing field to the dedup key; use per-event-type window semantics (PR #1141). |
| **C** | No recovery sweep on success: once an unresolved row is written, no subsequent successful call walks back and resolves it. Notifications keep firing forever. | Wire the success path to call `recordRecovery` / a sweep (PR #1132 + PR #1143). |

A single instance may exhibit more than one shape.

---

## Candidates

Each entry: `file:line`, brief code context, classification, suggested fix shape if CONFIRMED.

### 1. `app/api/cron/check-webhook-health/route.ts:112-122` — webhook silence alerts

```ts
const { error: alertErr } = await svc
  .from("social_connection_alerts")
  .insert({
    connection_id: firstConn.id as string,
    company_id: firstConn.company_id as string,
    severity: "warning",
    message: "No webhooks received from bundle.social in 24h …",
  });
```

- Cron schedule: daily `0 9 * * *` (`vercel.json:101`)
- Table: `social_connection_alerts (id, connection_id, company_id, severity, message, detected_at, acknowledged_at, resolved_at)` from `migrations/0070_platform_foundation.sql:367` — explicitly carries `resolved_at`, with `idx_connection_alerts_unresolved` partial index.
- No `acknowledged_at IS NULL AND resolved_at IS NULL` lookup before insert. A team silent for 7 days produces 7 alert rows for the same connection.

**Classification: CONFIRMED — Shape B** (insert where it should query first, then UPSERT or skip).

**Suggested fix shape:** before insert, `select id from social_connection_alerts where connection_id = $1 and resolved_at is null and acknowledged_at is null limit 1`. If row exists, skip. (Alternatively: add a partial UNIQUE index on `(connection_id) WHERE resolved_at IS NULL` and use `ON CONFLICT DO NOTHING`.)

**Impact × ease**: medium impact (alert-banner-spam, but warning severity) × low effort (single insert site, well-bounded blast radius).

---

### 2. `lib/social/approval/escalate.ts:37-65` — 48h/72h approval reminders

```ts
for (const draft of drafts ?? []) {
  const age = now - new Date(draft.created_at).getTime();
  if (age >= 96 * h) { /* auto-reject — state transition, single-fire */ }
  else if (age >= 72 * h) { await escalateToAdmin(…); escalated++; }
  else if (age >= 48 * h) { await sendReminderToApprover(…); escalated++; }
}
```

- Cron schedule: `0 */6 * * *` (every 6h)
- `social_post_drafts` carries no `last_reminder_sent_at` / `reminder_sent_count` / `escalation_sent_at` column.
- Between hours 48 and 72, the approver receives a reminder email **every 6h** → up to 4 reminders for the same draft.
- Between hours 72 and 96, the company admin receives an escalation email every 6h → up to 4 escalations.

**Classification: CONFIRMED — Shape C** (no "already sent" persistence; cron has no idea what it already emitted).

**Suggested fix shape:** add `reminder_sent_at` and `escalation_sent_at` timestamp columns to `social_post_drafts`. Filter the cron query: `… and (reminder_sent_at IS NULL or reminder_sent_at < created_at + 24h)` etc. Set the column in the same UPDATE that records the send.

**Impact × ease**: medium-high impact (email spam to approvers + admins on every stuck draft, every 6h) × medium effort (one migration + cron change + sendReminderToApprover writeback).

---

### 3. `lib/platform/cache/redis-cache.ts:14, 33` — Redis cache failure events

```ts
} catch (err) {
  logger.warn("cache.redis_get_failed", …);
  void recordHealthEvent({
    serviceName: "upstash-redis",
    operation: "cache.get",
    eventType: "service_5xx",
    severity: "warning",
    …
  });
  return null;
}
```

- `redisGet` / `redisSet` record `service_5xx` on failure (correct dedup via PR #1141's per-operation key + 5-min window).
- Success path bypasses `withHealthMonitoring` and never calls `recordRecovery` / `hasUnresolvedHealthEvent`. Once Redis hiccups, the unresolved row persists; the 30-min notification cron keeps re-firing the alert after Redis is healthy again.

**Classification: CONFIRMED — Shape C** (exact match for the #1132 fix shape, on a different service).

**Suggested fix shape:** refactor `redisGet` / `redisSet` to route through `withHealthMonitoring("upstash-redis", "cache.get", () => redis.get(key))`. The wrapper already handles both the error-record AND the recovery-sweep correctly.

**Impact × ease**: medium impact (every transient Redis blip produces a stuck unresolved alert; 30-min re-notification per row) × low-medium effort (two call sites; need to thread the value-vs-null return through the wrapper since `withHealthMonitoring` re-throws on error and these helpers swallow).

---

### 4. `lib/cap/cost-cap.ts:62-71` — cost-cap exceeded events

```ts
if (spentUsd >= capUsd) {
  void recordHealthEvent({
    serviceName: "cap",
    operation: "cost_cap_check",
    eventType: "cost_cap_exceeded",
    severity: "warning",
    details: { subscriptionId, spentUsd, capUsd },
  });
  throw new CostCapExceededError(…);
}
```

- `operation` is `"cost_cap_check"` (a constant), so subscription A and subscription B both exceeding the cap collide on the same `service_health_events` row. Details fields (subscriptionId) overwrite each other.
- `cost_cap_exceeded` is **not** in `LATCHED_EVENT_TYPES` (only `cron_stale` is), so it uses the 5-minute bursty window. For a "once you're over you stay over until billing rollover" condition, this means the row keeps getting re-inserted across days as the 5-min window expires.
- No recovery sweep when the next billing cycle resets `cap_generation_runs` spend back below cap.

**Classification: CONFIRMED — Shape B + Shape C.**

**Suggested fix shape:**
- Shape B fix: include `subscriptionId` in the dedup key (either via `operation` = `cost_cap_check:${subscriptionId}` or by adding subscription-id-aware columns to `service_health_events` + updating the dedup query in `recordHealthEvent`).
- Shape C fix: add `"cost_cap_exceeded"` to `LATCHED_EVENT_TYPES` so it dedupes across the long retention window. Add a recovery sweep in `budget-reset` cron that, after zeroing budget rows, calls a new `recordCostCapRecovery(subscriptionId)`.

**Impact × ease**: low-medium impact (warning severity, doesn't escalate to email per `health-check/route.ts:37` which filters `severity = 'critical'`, but operator dashboard noise) × medium effort (touches `LATCHED_EVENT_TYPES` + introduces a new operation-key convention).

---

### 5. `lib/cap/monthly-generation.ts:64-74` — missing objective template events

```ts
if (!sub.monthly_objective_template) {
  await recordHealthEvent({
    serviceName: "cap-cron",
    operation: "monthly-generation",
    eventType: "missing_objective_template",
    severity: "warning",
    details: { reason: …, company_id: sub.company_id, cap_subscription_id: sub.id },
  });
}
```

- Same shape as #4: `operation` is constant `"monthly-generation"`, so different subscriptions with missing templates collide on one row.
- `missing_objective_template` is not latched and not in any recovery sweep — once a template is later populated, the row stays unresolved.

**Classification: CONFIRMED — Shape B + Shape C.**

**Suggested fix shape:** identical pattern to #4 — bake `subscription_id` into the dedup key, add the event type to `LATCHED_EVENT_TYPES`, wire a recovery sweep into the path that sets `monthly_objective_template`.

**Impact × ease**: low impact (rare event, warning severity, operator-facing only) × low effort (same shape as #4).

---

### 6. `app/api/cron/insights-feature-extract/route.ts:124-130` and `app/api/cron/social-analytics-refresh/route.ts:67-73` — self-emitted `cron_stale` from non-heartbeat crons

```ts
await recordHealthEvent({
  serviceName: 'insights',
  operation: 'feature_extract',
  eventType: 'cron_stale',
  severity: 'warning',
  details: { error },
});
```

- These crons do NOT call `updateHeartbeat` (only `cap-generation-runs-cleanup`, `cap-monthly-generation`, `cost-monitoring-daily-report` and the `/api/internal/cron/*` crons do).
- They emit `cron_stale` themselves in their catch blocks.
- Because they never call `updateHeartbeat(jobName, "ok")`, `recordCronRecovery(jobName)` never fires for them. The unresolved row persists across subsequent successful runs.
- PR #1143's recovery-sweep wiring assumed every cron emitting `cron_stale` is also a heartbeat-participant. These two crons break that assumption.

**Classification: CONFIRMED — Shape C** (Shape B is OK here — `cron_stale` is in `LATCHED_EVENT_TYPES`, per-operation dedup works).

**Suggested fix shape:**
- Quickest: have these crons call `updateHeartbeat("feature-extract", "ok")` / `updateHeartbeat("social-analytics-refresh", "ok")` on success. The existing PR #1143 wiring then sweeps their own emitted rows on the next success.
- Alternative: don't emit `cron_stale` from cron error handlers — use `service_5xx` (bursty 5-min window, no recovery expectation built in) instead. The `cron_stale` event type's purpose is "the watchdog noticed this cron stopped running"; using it for "the cron ran but failed" is a semantic mismatch.

**Impact × ease**: low-medium impact (these crons fail rarely; when they do, they leave one unresolved row that the 30-min notification cron continues to alert on) × very low effort (3-line change per cron).

---

### 7. `lib/platform/social/publishing/rate-limits.ts:75-107` — non-atomic increment of `requests_made`

```ts
const existing = await getRateLimitWindow(connectionId);
if (existing) {
  await svc.from("social_rate_limits")
    .update({ requests_made: existing.requests_made + 1, updated_at: now })
    .eq("connection_id", connectionId)
    .eq("window_starts_at", starts);
} else {
  await svc.from("social_rate_limits").insert({…, requests_made: 1, …});
}
```

- The INSERT side is protected by a `UNIQUE (connection_id, window_starts_at)` constraint and tolerates the 23505 race.
- The UPDATE side does a non-atomic read-modify-write: two concurrent workers reading `requests_made = 5` both write `6`, losing one increment.
- Result: rate-limiter undercounts by up to `(in-flight concurrency - 1)` per window.

**Classification: NEEDS-INVESTIGATION** — partial pattern match.
The dedup logic itself is correct (UNIQUE + 23505 tolerance), but the increment is lossy under concurrency. This is closer to a "lost updates" bug than the dedup-or-persist bug pattern. Filed here because it shares the "concurrent writers think they're the only one" intuition.

**If this is judged in-scope:** the fix is `UPDATE … SET requests_made = requests_made + 1` (let Postgres do the increment atomically) instead of computing it in app code.

**Impact × ease**: low-medium impact (rate-limit fires slightly later than it should under heavy concurrent publish bursts) × very low effort (one-line SQL change).

---

### 8. In-flight provisioning Maps — `lib/platform/social/bundle-social/provision.ts:30` + `lib/platform/social/profiles/provision-team.ts:29`

```ts
const inflight = new Map<string, Promise<string>>();
```

- Module-level Map tracking concurrent in-process callers of `getOrCreateBundleSocialTeam(companyId)`.
- The comment explicitly notes: "Two layers of race protection: (1) In-process Promise dedup (module-level Map) — fast path. (2) `pg_advisory_xact_lock` — cross-process backstop covering the entire read → teamCreate → UPDATE."
- Cold start losing the Map means the slow path fires (one extra `teamCreateTeam` attempt that hits the lock and finds the team already exists on commit). Correctness preserved by the advisory lock.

**Classification: LIKELY-OK** — Map is explicitly a fast-path optimisation backed by a cross-process advisory lock. Documented as such in source. Correct usage pattern, not a candidate.

---

### 9. SDK client caches — `lib/anthropic-call.ts:66`, `lib/bundlesocial.ts:39`, `lib/redis.ts:19`, `lib/qstash.ts:28-29`, `lib/langfuse.ts:24`, `lib/logger.ts:81`

```ts
let cachedClient: Anthropic | null = null;
```

- Per-process client-instance caches. No state stored — just HTTP clients (or Redis clients) constructed lazily.
- Cold start re-constructs them. Cost: one allocation. No correctness impact.

**Classification: LIKELY-OK** — these are object caches, not state caches. Not candidates.

---

### 10. `lib/platform/service-health/recipients.ts:7-9` — staff-emails query cache (60s TTL)

```ts
let cachedEmails: string[] | null = null;
let cachePopulatedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute
```

- TTL'd query-result cache: avoid repeated `SELECT email FROM platform_users WHERE is_opollo_staff` within one notify cycle.
- Cold start → re-query. Correctness unaffected; just one extra DB hit.

**Classification: LIKELY-OK** — read-side cache with a short TTL, not state.

---

### 11. `lib/image/lease.ts` — image-gen Redis lease

```ts
const result = await redis.set(key, "1", { nx: true, ex: LEASE_TTL_SECONDS });
```

- Cross-process via Redis SET NX EX. TTL ensures crash-safety. Correctly designed.

**Classification: LIKELY-OK** — exemplary pattern; explicitly designed for cross-process correctness.

---

### 12. `lib/platform/social/connections/overdue-events.ts` — `has_emitted_overdue_event` flag

```ts
const targets = connections.filter(
  (c) => isChannelOverdue(c) && !c.has_emitted_overdue_event,
);
…
await svc.from("social_connections")
  .update({ has_emitted_overdue_event: true })
  .eq("id", c.id);
```

- Persistent boolean column on the row provides single-emission guarantee.

**Classification: LIKELY-OK** — exemplary pattern. Reference shape for items #1 (alerts) and #2 (reminders) when fixed.

---

### 13. `lib/platform/notifications/dispatch.ts:191-194` — every dispatch inserts a fresh `platform_notifications` row

```ts
const insert = await svc.from("platform_notifications").insert(rows).select("id");
```

- Intentional: every notification event is a new notification. The caller decides whether to fire; dispatch doesn't dedup.
- Distinct from the dedup pattern: the caller in CAP / approval / publish-result flows is responsible for "should I fire?" The dispatcher is not.

**Classification: LIKELY-OK** — design-by-contract write surface. The dedup question lives at every caller, not here.

---

### 14. `lib/platform/cron/cron-shared.ts:48-61` — non-atomic `run_count` increment in `updateHeartbeat`

```ts
const { data: current } = await svc
  .from("cron_heartbeats")
  .select("run_count").eq("job_name", jobName).maybeSingle();
await svc.from("cron_heartbeats")
  .update({
    …,
    run_count: ((current?.run_count as number | null) ?? 0) + 1,
  })
  .eq("job_name", jobName);
```

- Concurrent runs of the same job would both read N and both write N+1, losing one count.
- Vercel guarantees at most one cron instance per scheduled job at any time, so concurrency is practically impossible. Worst-case consequence: slight undercount. No correctness impact for any downstream consumer.

**Classification: LIKELY-OK** — same family as item #7 but no real-world concurrency surface.

---

## Summary

| Classification | Count | Items |
|---|---|---|
| **CONFIRMED** | 6 | #1, #2, #3, #4, #5, #6 |
| **NEEDS-INVESTIGATION** | 1 | #7 |
| **LIKELY-OK** | 7 | #8–#14 |

## Prioritised recommendation

Ranked by impact × ease (top of list = ship next):

1. **#3 Redis cache `service_5xx` recovery sweep** — exact #1132 shape on a different service; refactor `redisGet` / `redisSet` to route through `withHealthMonitoring`. Two files touched, very small change, eliminates a class of stuck alerts.

2. **#6 self-emitted `cron_stale` from non-heartbeat crons** — three-line addition (`updateHeartbeat(jobName, "ok")` on success) per cron unlocks PR #1143's existing recovery sweep for them. Two routes.

3. **#1 webhook-silence alert dedup** — one insert site, add a "select unresolved first" guard or a partial unique index. Cleans up the most likely operator-dashboard noise source.

4. **#2 approval reminder dedup** — needs a migration adding two columns to `social_post_drafts` + cron filter change. Higher effort but eliminates real email spam to approvers.

5. **#4 + #5 service-health events with global operation keys** — same architectural fix (per-entity operation key + add to `LATCHED_EVENT_TYPES` + recovery sweep). Ship together as a single follow-up to PR #1141.

6. **#7 rate-limit atomic increment** — low priority unless concurrent publish bursts become a real concern. One-line fix; ship if convenient when next touching `rate-limits.ts`.

## What this audit did NOT cover

- `app/api/optimiser/*` and `lib/optimiser/*` — out of scope by the request, but contain ~30 cron routes and several `recordHealthEvent` patterns worth a follow-up sweep.
- `lib/insights/*` — same. The cron audit only touched `social-analytics-refresh` and `insights-feature-extract` because they appeared in the `recordHealthEvent` callers list.
- Webhook receivers (`app/api/webhooks/*`) — relies on `social_webhook_events` UNIQUE (`event_id`) for idempotency; not re-verified here.
