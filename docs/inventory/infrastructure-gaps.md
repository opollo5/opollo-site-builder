# Infrastructure Gap Audit — 2026-05-26

> READ-ONLY investigation. No code was changed. Every claim is cited with file:line.

---

## Summary Dashboard

| Category | Coverage | Top Risk | P0 Count | Quick Win |
|---|---|---|---|---|
| A. RLS / Cross-tenant | ~95% tables | Service-role on non-scoped paths | 0 | No |
| B. Webhook Security | 100% of 3 webhooks | No timestamp replay protection | 0 | Yes |
| C. Idempotency | Strong (QStash path); weak (publish-due cron) | Dual publish race | 1 | Yes |
| D. Background Jobs / Crons | 41 registered, 2 orphaned | Silent failure on most non-critical crons | 0 | Yes |
| E. Race Conditions | Good on Q-path; TOCTOU on publish-due | Duplicate publish on concurrent ticks | 1 | Yes |
| F. Migration Safety | 147 migrations, 67 rollbacks | Unguarded ADD COLUMN on old migrations; ALTER TYPE not transaction-safe | 0 | Yes |
| G. PII / Secrets in Logs | Scrubber exists; emails logged in auth flows | Emails appear in structured logs unredacted | 0 | Yes |
| H. Session / Token | Good; known 2FA stale-cookie bug | Stale 2FA cookie redirects valid users | 0 | Yes (tracked) |
| I. Rate Limiting | Good on auth; partial on platform | Most social API routes unprotected | 0 | Yes |
| J. Backup / DR | No documented plan | No PITR confirmation, no token recovery path if DB lost | 0 | No |
| K. Third-Party Dependencies | 77 bundle.social refs; 6 probe scripts; 7 contract snapshots | Snapshot coverage gap for non-bundle.social SDKs | 0 | Yes |

**P0 total:** 2 (publish-due TOCTOU and publish-due dual-fire; they are the same root issue)
**P1 total:** 5
**P2 total:** 8

---

## Wake-Up Dashboard

### Top P0 / P1 Findings

**P0-1 — Dual-publish race in `publish-due` cron** (`app/api/internal/cron/publish-due/route.ts:41–68`): The cron does a two-step SELECT then UPDATE (not atomic). Two concurrent Vercel invocations can both SELECT the same rows before either UPDATE completes, resulting in both marking the rows `publishing` and both calling `publishPost`. The QStash path is protected by `claim_publish_job` RPC with a UNIQUE index; the `publish-due` cron path has no equivalent guard. The cron runs every minute and has concurrency=5.

**P1-1 — `cap-weekly-generation` and `check-webhook-health` cron routes have no Vercel schedule** (`vercel.json` has no entry for `/api/cron/cap-weekly-generation` or `/api/cron/check-webhook-health`). Both route files exist and have auth guards, but they will never be called automatically. `cap-weekly-generation` processes weekly AI-generated posts for clients; `check-webhook-health` detects silent bundle.social webhook failure.

**P1-2 — No timestamp/replay protection on `verifyBundlesocialSignature`** (`lib/bundlesocial.ts:68–92`): The HMAC verification is correct but there is no timestamp window check. A captured valid request body + signature can be replayed indefinitely. The `@upstash/qstash` Receiver (used by the QStash webhooks) includes replay protection built in; the bundle.social verifier does not. 

### Top 3 Recommended Next PRs

1. **Fix publish-due TOCTOU** — Replace the two-step SELECT+UPDATE in `publish-due/route.ts:41–68` with a single `UPDATE ... WHERE state='scheduled' AND scheduled_at <= NOW() AND publish_attempts < 3 RETURNING id,...` or a Postgres function mirroring `claim_publish_job`. This eliminates the dual-publish race.

2. **Add vercel.json entries** for `cap-weekly-generation` and `check-webhook-health`. These routes are fully implemented but dead — they will never fire automatically.

3. **Timestamp replay window on bundlesocial webhook** — Add a `x-timestamp` header check to `verifyBundlesocialSignature` with a ±5-minute window, matching the bundle.social documentation. Check their sending spec first; if they don't send a timestamp header today, document the gap as accepted risk.

---

## A. RLS / Cross-Tenant Isolation

### Coverage

122 `CREATE TABLE` statements across 147 migration files. 118 tables have `ENABLE ROW LEVEL SECURITY`. The two exceptions are:

- `email_log` (`supabase/migrations/0069_email_log.sql:18–20`): intentionally service-role-only; the migration comment documents this ("Service-role only — no RLS policy is added because all writes come from server-side lib/email/sendgrid.ts"). Risk is low — the table contains email addresses and send statuses but no sensitive payload content.
- `cron_heartbeats` (`supabase/migrations/0135_cron_infrastructure.sql:14–20`): internal ops table; only writable by server-side cron code via service-role. No user-facing data.

The platform layer uses three security-definer functions (`is_opollo_staff()`, `is_company_member(uuid)`, `has_company_role(uuid, role)`) defined in `supabase/migrations/0070_platform_foundation.sql:286–330`. All social, draft, connection, and analytics tables scope reads/writes through `is_company_member(company_id)`.

The `cross_tenant_identity` incident from 2026-05-11 (documented in `docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md`) resulted in a regression test at `tests/regressions/bsp10-connect-rejects-cross-tenant-profile.test.ts` and a `allow_cross_tenant_identity` flag on `platform_companies`.

### Service-Role Call Audit

All service-role calls were reviewed. Key observations:

| File:line | Query | Scoped by | Risk |
|---|---|---|---|
| `app/(platform)/company/social/layout.tsx:46–51` | SELECT timezone from platform_companies | `companyId` from `session.company.companyId` (session-derived) | LOW |
| `app/(platform)/company/social/posts/[id]/page.tsx:108,136` | SELECT social_post_drafts | `company_id` from URL param — checked against session after | MEDIUM (URL param, then session check) |
| `app/api/platform/social/drafts/[id]/route.ts:44–52` | SELECT company_id from social_post_drafts | Draft UUID from URL, then `requireCanDoForApi(company_id)` gate | LOW (gate runs after lookup) |
| `app/api/insights/recommendations/route.ts:27–39` | SELECT ins_recommendations | `company_id` from query param after `requireCanDoForApi` gate | LOW |
| `app/api/insights/consent/route.ts:54–58` | UPSERT ins_consent | `company_id` from body after `requireCanDoForApi` gate | LOW |
| `lib/platform/auth/current-user.ts:42–68` | SELECT platform_users + auto-provision | `userId` from `auth.getUser()` (verified JWT) | LOW |
| `app/api/platform/companies/list/route.ts:64` | SELECT platform_companies | `getCurrentPlatformSession()` guards to staff-only | LOW |
| `app/(public)/review/[token]/page.tsx:49` | SELECT social_approval_requests by token | Token looked up via hashed value | LOW |
| `app/api/approve/[token]/decision/route.ts:86` | UPDATE social approval | Token validated before service-role call | LOW |

The pattern used consistently: service-role is used for the initial lookup (to load the `company_id` from the row), then `requireCanDoForApi(company_id, action)` is called against the session. This means there is a TOCTOU window between lookup and gate, but it is not exploitable for cross-tenant data exfiltration because the gate uses the row's own `company_id`.

### Risks

**P2:** `app/(platform)/company/social/posts/[id]/page.tsx:108` uses service-role to load `company_id` from a URL path param `[id]`, then calls the gate. If the gate call fails silently (network error, misconfigured), the data could be rendered. However, the code appears to have proper error handling inline.

**P2:** `email_log` and `cron_heartbeats` tables have no RLS. The tables hold email addresses (in `email_log`) and cron run timestamps. Both are service-role-only by design, but an exploit that obtained a user-level DB connection (e.g., a compromised anon key) could read all email addresses. Low practical risk given no anon key is provisioned.

### Quick wins
- Confirm `email_log` cannot be reached via anon key (verify no anon grant in migrations).
- Add `ENABLE ROW LEVEL SECURITY; CREATE POLICY service_role_all ON cron_heartbeats USING (false);` to `cron_heartbeats` for defence-in-depth.

---

## B. Webhook Security

### Coverage

Three webhook receivers exist:

1. `app/api/webhooks/bundlesocial/route.ts` — inbound bundle.social events
2. `app/api/webhooks/qstash/social-publish/route.ts` — QStash scheduled publish callback
3. `app/api/webhooks/qstash/social-post-history-import/route.ts` — QStash analytics import callback

All three:
- Preserve raw body via `req.text()` before parsing (correct order)
- Verify signature before touching any business logic
- Return 401 on mismatch, 503 when secret is unset

### Signature Verification Detail

**bundle.social** (`lib/bundlesocial.ts:68–92`): HMAC-SHA256 of raw body, compared with `timingSafeEqual`. Correct. Does NOT check a timestamp header. Per bundle.social's docs, they include `x-timestamp`; the code ignores it.

**QStash** (`lib/qstash.ts:66–79`): Delegates to `@upstash/qstash` SDK's `Receiver.verify()`. The Upstash SDK includes built-in timestamp validation (5-minute window), so replay protection IS present on both QStash endpoints.

### Security Test Coverage

`tests/security/bundle-social-webhook.security.test.ts` covers:
- Missing signature → 401
- Wrong-signed body → 401
- Body tampered after signing → 401
- Correct HMAC → 200
- Duplicate delivery → 200 `already_processed`
- No secret env → 503
- Equal-length wrong signature (timing attack) → 401

`tests/security/qstash-webhook.security.test.ts` and `tests/security/qstash-post-history-import.security.test.ts` cover the QStash endpoints.

### Risks

**P1:** `verifyBundlesocialSignature` (`lib/bundlesocial.ts:76–92`) has no timestamp window check. A captured valid webhook can be replayed indefinitely. The QStash path has replay protection via the Upstash SDK; bundle.social lacks it. The idempotency layer (`UNIQUE (event_id)` on `social_webhook_events`) provides application-level dedup, but this requires the same `event_id` — an attacker could construct a novel payload.

**P2:** Both QStash webhooks use `verifyQstashSignature` but the `QSTASH_NEXT_SIGNING_KEY` is optional (`lib/qstash.ts:51`: `nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY ?? ""`). If `QSTASH_NEXT_SIGNING_KEY` is unset in production, key rotation will fail silently — requests signed with the new key will be rejected until the env var is updated.

### Quick wins
- Add `x-timestamp` validation to `verifyBundlesocialSignature` with a ±5-minute window (check bundle.social sending spec first).
- Confirm `QSTASH_NEXT_SIGNING_KEY` is set in Vercel production env.

---

## C. Idempotency

### Coverage

**Strong idempotency surfaces:**
- `POST /api/admin/batch` (`app/api/admin/batch/route.ts:44–66`): requires `Idempotency-Key` header; returns 200 for replay.
- QStash publish callback uses `claim_publish_job` RPC (`supabase/migrations/0075_claim_publish_job_fn.sql`): UNIQUE partial index on `social_publish_jobs(schedule_entry_id)` — concurrent claims race at INSERT and second writer gets `ALREADY_CLAIMED`.
- bundle.social webhook: `UNIQUE (event_id)` on `social_webhook_events` (`supabase/migrations/0070_platform_foundation.sql:32`); ON CONFLICT is the dedup mechanism.
- `POST /api/platform/social/drafts` has optional `idempotency_key` field (`app/api/platform/social/drafts/route.ts:51`).

**Weak idempotency surfaces:**

**P0:** `app/api/internal/cron/publish-due/route.ts:41–68` — The publish-due cron runs every minute. It does a two-step `SELECT WHERE state='scheduled'` followed by `UPDATE SET state='publishing'`. These are two separate DB calls. Between them, a second concurrent invocation can also select the same rows, resulting in both calling `publishPost`. The comment on line 40 says "FOR UPDATE SKIP LOCKED equivalent: we update in the same Postgres call" but this is incorrect — the SELECT and UPDATE are separate calls; there is no database-level lock held between them.

The `publish-due` path uses `publishPost` from `lib/social/publishing/bundle-social-client.ts`, NOT `fireScheduledPublish` which uses the atomic `claim_publish_job` RPC. The fix is to consolidate both paths to use a database-level claim, or replace the SELECT+UPDATE with a single `UPDATE ... RETURNING` query.

### Risks

**P0:** Dual publish race on `publish-due` cron — two simultaneous Vercel invocations can publish the same post twice to bundle.social. The risk increases with longer queue depths or cron overlap during cold starts.

**P2:** `POST /api/platform/social/drafts` — the optional `idempotency_key` is stored in `social_post_drafts.draft_data.idempotency_key` (app-level) but is not enforced with a UNIQUE constraint. A client that retries on a 5xx response may create two identical drafts.

### Quick wins
- Replace publish-due's two-step SELECT+UPDATE with `UPDATE social_post_drafts SET state='publishing' WHERE state='scheduled' AND scheduled_at <= NOW() AND publish_attempts < 3 RETURNING id, company_id, content, ...` — this is atomic in Postgres.

---

## D. Background Jobs / Crons

### Schedule Inventory (41 registered in vercel.json)

| Path | Schedule | Purpose | Heartbeat |
|---|---|---|---|
| `/api/cron/process-batch` | every minute | Lease + process one generation slot | No |
| `/api/cron/process-regenerations` | every minute | Regen worker tick | No |
| `/api/cron/process-brief-runner` | every minute | Brief runner tick | No |
| `/api/cron/budget-reset` | hourly | Reset per-tenant cost budgets | No |
| `/api/cron/optimiser-sync-ads` | 04:00 daily | Sync Google Ads data | No |
| `/api/cron/optimiser-sync-clarity` | 04:30 daily | Sync Clarity analytics | No |
| `/api/cron/optimiser-sync-ga4` | 05:00 daily | Sync GA4 data | No |
| `/api/cron/optimiser-sync-pagespeed` | 06:00 weekly (Mon) | Sync PageSpeed scores | No |
| `/api/cron/optimiser-evaluate-pages` | 07:00 daily | Evaluate page scores | No |
| `/api/cron/optimiser-score-pages` | 07:30 daily | Compute optimiser scores | No |
| `/api/cron/optimiser-email-digest` | 09:00 daily | Email daily digest | No |
| `/api/cron/optimiser-expire-proposals` | 08:00 daily | Expire stale proposals | No |
| `/api/cron/optimiser-evaluate-scores` | 07:45 daily | Evaluate score deltas | No |
| `/api/cron/optimiser-evaluate-causal-deltas` | 08:15 daily | Causal delta analysis | No |
| `/api/cron/optimiser-monitor-rollouts` | hourly | Monitor A/B rollouts | No |
| `/api/cron/optimiser-ab-monitor` | every 15 min | A/B test monitoring | No |
| `/api/cron/optimiser-assisted-approval` | every 30 min | Assisted approval workflow | No |
| `/api/cron/optimiser-extract-patterns` | 10:00 daily | Extract optimiser patterns | No |
| `/api/cron/optimiser-sync-vercel-logs` | 11:00 daily | Sync Vercel logs | No |
| `/api/cron/dispatch-webhooks` | every minute | Dispatch outbound webhooks | No |
| `/api/cron/social-publish-backfill` | every 5 min | Re-enqueue missed QStash messages | No |
| `/api/cron/social-publish-watchdog` | every 5 min | Watchdog for stuck publishing state | No |
| `/api/cron/cap-monthly-generation` | 04:00 on 1st of month | Monthly CAP post generation | No |
| `/api/cron/cap-generation-runs-cleanup` | 02:00 daily | Clean up stale CAP runs | No |
| `/api/cron/cost-monitoring-daily-report` | 07:00 daily | Daily cost report email | No |
| `/api/cron/social-connections-health` | 03:00 daily | Check connection health | No |
| `/api/cron/social-analytics-refresh` | 04:00 daily | Refresh analytics cache | No |
| `/api/cron/insights-feature-extract` | every 15 min | Extract insight features | No |
| `/api/cron/insights-recompute` | 04:30 daily | Recompute insights | No |
| `/api/cron/insights-pattern-mine` | 06:00 Sundays | Mine insight patterns | No |
| `/api/cron/insights-competitor-scrape` | 07:00 daily | Scrape competitor data | No |
| `/api/cron/render-pages` | every 5 min | Render queued pages | No |
| `/api/cron/drift-detect` | hourly | Detect content drift | No |
| `/api/cron/backfill-image-captions` | every 5 min | Backfill image captions | No |
| `/api/cron/extract-image-metadata` | every minute | Extract image metadata | No |
| `/api/internal/cron/publish-due` | every minute | Publish scheduled posts | YES (`cron_heartbeats`) |
| `/api/internal/cron/heartbeat-check` | every 5 min | Check heartbeat staleness | YES |
| `/api/internal/cron/health-check` | every 5 min | Fire health notifications | YES |
| `/api/internal/cron/cleanup-cache` | 03:00 daily | Clean Redis/Postgres cache | YES |
| `/api/internal/cron/escalate-approvals` | every 6 hours | Escalate stale approvals | YES |
| `/api/internal/cron/health-digest` | 23:00 daily | Daily health digest email | YES |

**Orphaned route files (no vercel.json entry):**
- `/api/cron/cap-weekly-generation` — weekly CAP post generation for opted-in companies (`app/api/cron/cap-weekly-generation/route.ts`)
- `/api/cron/check-webhook-health` — daily check for bundle.social webhook silence (`app/api/cron/check-webhook-health/route.ts`)

### Failure Behavior

**Heartbeat monitoring:** The `internal/cron/*` jobs call `updateHeartbeat()` (`lib/platform/cron/cron-shared.ts:43–62`) on every tick. `heartbeat-check` (`app/api/internal/cron/heartbeat-check/route.ts`) monitors staleness and raises `service_health_events`. `health-check` fires notifications for critical events.

**The 35 `/api/cron/*` jobs have NO heartbeat monitoring.** They log errors via `logger.error()` but do not update `cron_heartbeats`. Silent failures in `process-batch`, `process-brief-runner`, `dispatch-webhooks`, etc., would go undetected until an operator noticed stale data.

**No dead-letter queue.** A cron job that fails (5xx) is retried by Vercel once; after that, the failure is silent. `dispatch-webhooks/route.ts:19` mentions "delivery is dead-lettered" but this is within the webhook dispatch logic, not a system-level DLQ.

### Risks

**P1:** 35 of 41 cron jobs have no heartbeat monitoring. `process-batch` (brief generation, every minute), `dispatch-webhooks` (every minute), and all Optimiser sync jobs could fail silently for hours or days.

**P1:** `cap-weekly-generation` and `check-webhook-health` are fully implemented but not scheduled. `cap-weekly-generation` generates client posts; without it, `cap_weekly_enabled` companies receive no posts.

### Quick wins
- Add `cap-weekly-generation` (suggested: Mondays 06:00) and `check-webhook-health` (suggested: daily 09:00) to `vercel.json`.
- Consider expanding heartbeat tracking to the top 5 high-value crons: `process-batch`, `process-brief-runner`, `dispatch-webhooks`, `cap-monthly-generation`, `render-pages`.

---

## E. Race Conditions

### Coverage

**Well-protected:**
- `lib/batch-worker.ts:149,252` — uses raw SQL `FOR UPDATE SKIP LOCKED` via Postgres function.
- `lib/brief-runner.ts:291,377` — `FOR UPDATE SKIP LOCKED` via `leaseBriefRun` RPC.
- `lib/regeneration-worker.ts:118` — `FOR UPDATE SKIP LOCKED`.
- `supabase/migrations/0075_claim_publish_job_fn.sql` — `claim_publish_job` RPC with UNIQUE partial index providing deterministic first-writer-wins claim.
- Draft saves: CAS on `draft_version` column (`app/api/platform/social/drafts/[id]/route.ts:69–79`); 409 VERSION_CONFLICT on stale version.

**Not protected:**

**P0:** `app/api/internal/cron/publish-due/route.ts:41–68` — Two-step SELECT then UPDATE. Two concurrent invocations (Vercel may start a new function before the previous one has committed the UPDATE) can both observe `state='scheduled'` rows, both mark them `publishing`, and both call `publishPost`. The comments on line 40 claim "FOR UPDATE SKIP LOCKED equivalent" but no lock is held between the SELECT and the subsequent UPDATE.

**P1:** `supabase/migrations/0117_provision_advisory_lock.sql` exists (advisory lock helper for `pg_advisory_xact_lock`). This suggests advisory locking was considered but the `publish-due` cron path does not use it.

### Optimistic Locking Coverage

Version-lock (CAS) is implemented on:
- `social_post_drafts.draft_version` — `app/api/platform/social/drafts/[id]/route.ts:77`
- `briefs.version_lock` — `app/api/briefs/[brief_id]/pages/route.ts:19,123`
- `pages` (site pages) — `app/api/admin/sites/[id]/pages/[pageId]/route.ts:21`
- `admin images` — `app/api/admin/images/[id]/route.ts:25`
- `site budgets` — `app/api/admin/sites/[id]/budget/route.ts:16`
- `brand voice` — `app/api/admin/sites/[id]/voice/route.ts:20`

### Risks

**P0:** Dual-publish on `publish-due` cron (same as C-P0 above).

**P2:** `app/api/platform/social/connections/callback/route.ts:300` — async fire-and-forget `void getServiceRoleClient()...` pattern inside the OAuth callback. If two OAuth callbacks arrive concurrently for the same `company_id` (e.g., a user double-clicked "Connect"), both could attempt to sync/insert the same connection. The UNIQUE constraint on `bundle_social_account_id` in `social_connections` would catch the duplicate at INSERT time, but an unhandled conflict on the concurrent sync could leave the second row in a degraded state. This is low-probability in practice.

### Quick wins
- Replace `publish-due` SELECT+UPDATE with atomic `UPDATE ... RETURNING` (also fixes C-P0).

---

## F. Migration Safety

### Coverage

147 migration files (0001–0151), 67 rollback scripts. The rollback coverage is ~46% (67/147). Most rollbacks cover the early core migrations (0002–0034); none exist for migrations 0035 onward (the platform layer, social module, optimiser integrations, insights module).

**Destructive operations found:**
- `supabase/migrations/0014_drop_dead_schema.sql:9–14` — `DROP TABLE IF EXISTS` for obsolete tables (safe, IF EXISTS guarded).
- `supabase/migrations/0062_auth_foundation_2fa_schema.sql:35–36` — `DROP TABLE IF EXISTS trusted_devices CASCADE` and `login_challenges CASCADE` (safe, recovery preamble).
- `supabase/migrations/0070_platform_foundation.sql:42–59` — large `DROP TABLE IF EXISTS ... CASCADE` block (recovery preamble; all objects are recreated in the same file).
- `supabase/migrations/0063_auth_foundation_roles_and_invites.sql:186–187` — `DROP TABLE IF EXISTS user_audit_log CASCADE; DROP TABLE IF EXISTS invites CASCADE` (recovery preamble).

All destructive operations are either guarded by `IF EXISTS` or are explicit recovery preambles for re-runnable migrations.

**ALTER TYPE operations:**
- `supabase/migrations/0074_platform_audit_and_brand.sql:56–57`: `ALTER TYPE ... ADD VALUE IF NOT EXISTS` — this is NOT transaction-safe in Postgres (documented at line 15 of migration 0021). The migration comments acknowledge this (line 50: "ALTER TYPE ... ADD VALUE IF NOT EXISTS is PG13+. Supabase ships PG15"). Four migrations use this pattern (0074, 0122, 0124, 0126). Each is in its own transaction block.
- Risk: if a migration partially fails after an `ALTER TYPE ADD VALUE` and before the dependent schema change, the enum value is visible but the column or default using it may not exist. The `IF NOT EXISTS` guard prevents re-run failures, but the partial-apply state would be inconsistent.

**ADD COLUMN without IF NOT EXISTS:**
Early migrations (0006, 0008, 0009, 0060, 0066, 0067, 0068) use bare `ALTER TABLE ADD COLUMN` without `IF NOT EXISTS`. These migrations have no rollback scripts and are safe only because they have never been re-applied. A fresh-environment re-apply or a migration-order reshuffle would fail.

### Risks

**P1:** No rollback scripts exist for migrations 0035–0151 (~110 migrations). A failed migration in the platform/social/insights layers has no automated rollback path. The runbook (`docs/runbooks/RUNBOOK.md:295`) references "recent Supabase backup" for destructive-step recovery, but no backup procedure is documented.

**P2:** Four migrations use `ALTER TYPE ... ADD VALUE` outside a transaction-safe pattern. Partial failure leaves the enum in an inconsistent state with the table schema. The `IF NOT EXISTS` guard on re-run means the inconsistency persists silently.

**P2:** Early migrations use bare `ADD COLUMN` without `IF NOT EXISTS` guards. Not a production risk today but would break a fresh-environment deploy that already had partial schema applied.

### Quick wins
- Write rollback scripts for the most critical recent migrations (social_post_drafts `0112`, platform foundation `0070`, insights `0144`). Even a "DROP TABLE CASCADE" rollback is better than nothing.
- Add `IF NOT EXISTS` to bare `ADD COLUMN` statements in early migrations.

---

## G. PII / Secrets in Logs

### Coverage

**Scrubber exists:** `lib/error-reporting/scrubber.ts` — `scrubPayload()` redacts keys matching `/password|token|secret|api[_-]?key|authorization|cookie/i`, replaces JWTs with `[jwt-redacted]`, strips email addresses from free-form strings, and checks for Luhn-valid card numbers. This runs before client-side error reports are sent and before server-side persistence.

**Logger sanitizer:** `lib/logger.ts:56–72` — `sanitize()` handles depth-limited object traversal and Error serialization but does NOT apply the scrubber. The logger does not strip sensitive field values.

**Email addresses in auth logs (unredacted):**
- `app/api/auth/forgot-password/route.ts:69`: `logger.warn("forgot_password_rate_limited", { email })` — logs the email address when rate-limited.
- `app/api/auth/forgot-password/route.ts:95`: `logger.warn("forgot_password_supabase_error", { email, error: error.message })`.
- `app/api/auth/forgot-password/route.ts:102`: `logger.info("forgot_password_requested", { email })`.

This means every forgot-password request (whether by the legitimate user or an attacker enumerating emails) writes the email to Axiom + Vercel logs. The response body already protects against enumeration (always returns success), but the server logs reveal whether an email was submitted.

**No committed secrets found** (`lib/error-reporting/scrubber.ts:18` contains the JWT regex as a string literal, which is not a secret). No `sk_live`, `sk_test`, `bnd_`, or bare JWT strings appear in non-test source files.

**Console.log usage:** `grep -rn "console\." app/ lib/` found 83 hits. The vast majority are in `lib/scripts/` (offline audit scripts, not request handlers) and `lib/logger.ts` itself. `app/api/emergency/route.ts:93` uses `console.error` directly for its break-glass path.

### Risks

**P1:** Email addresses are logged unredacted in 3 places in `app/api/auth/forgot-password/route.ts`. If Axiom / Vercel logs are accessible to unauthorized parties, this leaks the email roster. The scrubber would need to be applied at the logger level to catch structured fields.

**P2:** `lib/logger.ts`'s `sanitize()` does not apply the `SENSITIVE_KEY_RE` scrub (`password`, `token`, `secret` keys in the fields object would pass through unredacted). The scrubber is only called in the client error reporting path.

**P2:** `app/api/emergency/route.ts:93` logs via raw `console.error`, bypassing the structured logger and any future scrubber integration.

### Quick wins
- Add `lib/error-reporting/scrubber.ts`'s `SENSITIVE_KEY_RE` check to `lib/logger.ts`'s `sanitize()`.
- Replace `{ email }` in `forgot-password` log calls with `{ email_masked: email.replace(/@.+/, '@...') }` or remove the email field from logs entirely.

---

## H. Session / Token Handling

### Coverage

**Session management:** `middleware.ts:281` uses `supabase.auth.getUser()` (server-verified against GoTrue) rather than `getSession()`. This means revoked tokens are caught at the JWT boundary, not just at the JWT's natural expiry. `lib/__tests__/auth.test.ts` has a regression test pinning this behaviour.

**Cookie security:** All session cookies use `httpOnly: true, secure: true, sameSite: "lax"` — confirmed in `app/api/auth/complete-login/route.ts:62–64`, `app/api/account/devices/[id]/route.ts:69–71`, `lib/2fa/cookies.ts:14`.

**Refresh token rotation:** Supabase Auth handles refresh token rotation automatically. `lib/auth-revoke.ts:18,63,69` deletes from `auth.refresh_tokens` directly for explicit revocation. `lib/auth-callback.ts:87` uses `setSession({ access_token, refresh_token })` for implicit-flow token exchange.

**Session expiry UI:** `lib/hooks/use-session-expiry.ts` tracks expiry client-side. `lib/hooks/use-session-grace.ts` handles grace-period logout on expiry.

**Known 2FA stale-cookie bug (tracked in MEMORY.md):** `middleware.ts:311` checks `opollo_2fa_pending` cookie presence without verifying `is2faEnabled()`. A stale cookie from a prior session where 2FA was enabled persists and redirects users to `/login/check-email` even when `AUTH_2FA_ENABLED=false`. `app/login/actions.ts:114–116`'s early-return path (flag off) also omits `clearStale2faCookies()`.

### Risks

**P1 (tracked):** Stale 2FA cookie bug — `middleware.ts:311` and `app/login/actions.ts:114`. Documented in MEMORY.md as a latent bug that fires for all users if `AUTH_2FA_ENABLED` is toggled off. It is not a security vulnerability but a UX lockout.

**P2:** `QSTASH_NEXT_SIGNING_KEY` is optional (`lib/qstash.ts:51`). During a key rotation, requests signed with the new key would fail verification until the env var is updated. This is a deployment ops risk, not a code bug.

**P2:** The `opollo_selected_company_id` staff cookie (`lib/platform/auth/current-user.ts:16`) is set server-side but not HMAC-signed. An attacker who could set cookies (e.g., via subdomain takeover or misconfigured CORS) could forge a staff company context. In practice, company UUIDs are not guessable and the staff flag is checked separately.

### Quick wins
- Fix the 2FA stale cookie bug: add `clearStale2faCookies()` to `middleware.ts` before the 2FA gate and to `loginAction`'s early-return path.

---

## I. Rate Limiting

### Coverage

Rate limiting is implemented in `lib/rate-limit.ts` using Upstash Redis (sliding window). The platform-level endpoints additionally have a two-layer Upstash + Postgres fallback via `lib/platform/rate-limit/index.ts`.

**Auth endpoints — all covered:**
- `POST /login` (server action): `checkRateLimit("login", "ip:<ip>")` (`app/login/actions.ts:78`)
- `GET /api/auth/callback`: `checkRateLimit("auth_callback", "ip:<ip>")` (`app/api/auth/callback/route.ts:80`)
- `POST /api/auth/forgot-password`: `checkRateLimit("password_reset", "email:<email>")` (`app/api/auth/forgot-password/route.ts:67`)
- `POST /api/auth/accept-invite`: `checkRateLimit("login", "ip:<ip>")` (`app/api/auth/accept-invite/route.ts:35`)

**Platform API endpoints — partially covered:**
- `POST /api/platform/social/drafts/bulk`: `checkPlatformRateLimit("csv_upload")` — covered
- `POST /api/platform/social/drafts`: `checkPlatformRateLimit("chat")` — covered
- `GET /api/platform/social/drafts/[id]/analytics`: `checkPlatformRateLimit("chat")` — covered

**Platform API endpoints — NOT rate limited:**
- `POST/PATCH /api/platform/social/connections/*` — no rate limiting
- `GET/POST /api/platform/invitations/*` — no rate limiting (note: admin-side `/api/admin/invites/route.ts:52` is limited)
- `GET/PUT /api/insights/*` — no rate limiting
- `GET/POST /api/platform/brand/*` — no rate limiting
- `GET/POST /api/platform/notifications/*` — no rate limiting

**Fail-open semantics:** `lib/rate-limit.ts:155–165` — when Upstash is not configured or fails, all calls pass. This means if `UPSTASH_REDIS_REST_URL`/`TOKEN` are unset or Redis is down, rate limiting is completely disabled on the non-platform-layer endpoints. The `checkPlatformRateLimit` two-layer path is fail-closed (`lib/platform/rate-limit/index.ts:24–27`).

### Risks

**P1:** Social connection management endpoints (`/api/platform/social/connections/*`) have no rate limiting. An authenticated user could enumerate or brute-force connection states at arbitrary speed.

**P1:** Fail-open semantics on standard `checkRateLimit` — if Upstash goes down or is not configured, the auth endpoints (login, callback, password reset) become unprotected. The `checkPlatformRateLimit` two-layer path mitigates this for platform-layer endpoints only.

**P2:** `POST /api/platform/invitations/accept` has `checkRateLimit("invite_accept")` in the underlying lib (`lib/rate-limit.ts:CONFIGS.invite_accept`), but the route handler itself was not checked directly — needs verification.

### Quick wins
- Apply `checkRateLimit("admin_write", ...)` or similar to the social connections management endpoints.
- Document that Upstash is required in production and configure an alert if the health probe detects Redis unavailable.

---

## J. Backup / Disaster Recovery

### Coverage

**No backup documentation exists.** The runbook (`docs/runbooks/RUNBOOK.md`) references "a recent Supabase backup" in one sentence (line 295) without documenting the backup tier, frequency, or how to restore. No PITR configuration is documented. No DR runbook section exists.

**Token recovery risk:** Social connections store only `bundle_social_account_id` (a team-scoped ID) in `social_connections`. No OAuth access tokens or refresh tokens are stored in Opollo's database — these are managed entirely by bundle.social. If the database is lost and restored from backup, no OAuth tokens are lost because none are held. This is the correct architecture for bundle.social.

**Optimiser credentials:** `opt_client_credentials` stores AES-256-GCM encrypted payloads (`lib/optimiser/credentials.ts:67`). The encryption key is `OPOLLO_MASTER_KEY` (env var). If the database is restored from backup but `OPOLLO_MASTER_KEY` has rotated since the backup, decryption will fail (key version mismatch). The code checks `CURRENT_KEY_VERSION = 1` (`lib/encryption.ts:20`) and only supports v1; rotation is described as "Stage 1a" with v2 not yet implemented.

**Site credentials:** `site_credentials.encrypted_value` stores encrypted WordPress app passwords (AES-256-GCM, same key). Same rotation risk.

### Risks

**P1:** No documented PITR or backup verification procedure. If a destructive migration is applied in production, the runbook says to "confirm no data loss against a recent Supabase backup" but does not say what tier is provisioned, how to restore, or how to test the restoration.

**P1:** `OPOLLO_MASTER_KEY` rotation path is incomplete. Only v1 is supported (`lib/encryption.ts:27–31`). A key rotation would require a decrypt-and-re-encrypt migration before the old key could be removed. No migration or procedure exists for this.

**P2:** 80 migrations (0035–0151) have no rollback script. A failed migration can only be recovered from backup or manual SQL reversal.

### Quick wins
- Document in RUNBOOK.md: Supabase plan tier, backup frequency, PITR window, and restore procedure.
- Create `docs/architecture/KEY_ROTATION.md` documenting how to rotate `OPOLLO_MASTER_KEY` with a decrypt-and-re-encrypt migration plan.

---

## K. Third-Party Dependencies

### Coverage

**bundle.social integration:** 77 non-test TypeScript references (`grep -rn "bundlesocial\|bundle-social"` excluding test/mock/spec). The integration surface covers:
- OAuth connect/disconnect/reconnect
- Post creation (publish)
- Post history import
- Profile sync
- Webhook event ingestion

**Probe scripts** (`scripts/probes/`):
- `bundle-social.ts` — bundle.social API probe
- `insights-generation-priors.ts`
- `insights-recommendations.ts`
- `probe-ai-prefill.ts`
- `_platform-matrix-probe.ts`

Five probe scripts for 5 integration surfaces. No probe exists for:
- QStash (no `scripts/probes/qstash.ts`)
- Optimiser connectors (Google Ads, GA4, Clarity, PageSpeed)
- Sendgrid email delivery

**Contract snapshots** (`lib/__tests__/__snapshots__/`):
- `ai-prefill.contract.test.ts.snap`
- `customer-connect-profile.contract.test.ts.snap`
- `generation-priors.contract.test.ts.snap`
- `profile-connect.contract.test.ts.snap`
- `profile-disconnect.contract.test.ts.snap`
- `social-channels.contract.test.ts.snap`
- `social-identity-fingerprint.contract.test.ts.snap`

Seven contract snapshots covering bundle.social API shapes and Anthropic response shapes. No contract snapshots exist for:
- QStash message shape
- Optimiser API responses (Google Ads, GA4)
- SendGrid responses

**Secrets check:** No committed secrets found. `lib/error-reporting/scrubber.ts:18` contains only the regex pattern `eyJ...` to detect JWTs, not an actual JWT. All environment variables are accessed via `process.env.*` with no hardcoded fallback values beyond empty strings.

### Risks

**P1:** No probe scripts for QStash, Optimiser connectors, or SendGrid. Per the CLAUDE.md `Live diagnostic protocol`, diagnosing a third-party issue requires a probe script. Missing probes mean the diagnostic protocol cannot be followed for these integrations.

**P1:** No contract snapshots for QStash message envelope, Google Ads/GA4 API responses. A breaking API change (e.g., Google Ads deprecating a field) would fail at runtime without a test catching the contract drift.

**P2:** `QSTASH_NEXT_SIGNING_KEY` is optional in `lib/qstash.ts:51`. This means the production deployment may not have the next signing key configured, which would cause all QStash webhooks to fail during a key rotation window.

**P2:** The `OPOLLO_MASTER_KEY` rotation path references "Stage 1a" suggesting multi-key support was designed but not implemented. Any future key compromise requires a decrypt-and-re-encrypt migration with no tooling.

### Quick wins
- Add probe scripts for QStash (`scripts/probes/qstash.ts`) and SendGrid (`scripts/probes/sendgrid.ts`).
- Add contract snapshot tests for the QStash message envelope and at least one Optimiser API (Google Ads or GA4).

---

*Audit conducted: 2026-05-26. All findings are based on static code analysis of branch `fix/composer-central-image-library`. Runtime behaviour (e.g., whether Upstash is configured, Supabase backup tier) was not verified — claims about runtime state are noted as uncertain.*
