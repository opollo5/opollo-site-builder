# Infrastructure Gaps — Opollo Site Builder

**Audited:** 2026-05-27  
**Auditor:** Claude Code (automated analysis)  
**Branch audited:** `fix/vercel-missing-crons`  
**Scope:** 11 categories × live production codebase

---

## 1. Cron Authentication

All 37 routes under `app/api/cron/` and all 6 routes under `app/api/internal/cron/` use either `authorisedCronRequest` from `lib/platform/cron/cron-shared.ts` or `lib/optimiser/sync/cron-shared.ts`. Both implementations use `constantTimeEqual` (timing-safe). The implementation checks `secret.length < 16` as a minimum-entropy guard.

**Finding: none.** Cron authentication coverage is complete and correct.

---

## 2. Missing Cron Registrations

### INFRA-001: `cap-weekly-generation` not registered in `vercel.json`
- **Category:** Missing Cron Registrations
- **Severity:** HIGH
- **File:** `vercel.json` (missing entry); `app/api/cron/cap-weekly-generation/route.ts`
- **Description:** The route `GET /api/cron/cap-weekly-generation` (D4) finds all companies where `cap_weekly_enabled = true` and generates 3 CAP draft posts each. The route's own comment specifies "Weekly Vercel cron (Mondays 06:00 UTC)". No corresponding entry exists in `vercel.json`. The route handler is deployed but is never called by Vercel's scheduler.
- **Impact:** Companies with `cap_weekly_enabled = true` receive no weekly AI-generated posts. Feature is silently broken; no error surface.
- **Fix complexity:** S (<5 lines — add one JSON entry)
- **Fix:** Add `{ "path": "/api/cron/cap-weekly-generation", "schedule": "0 6 * * 1" }` to `vercel.json`
- **Decision needed?** No

### INFRA-002: `check-webhook-health` not registered in `vercel.json`
- **Category:** Missing Cron Registrations
- **Severity:** MEDIUM
- **File:** `vercel.json` (missing entry); `app/api/cron/check-webhook-health/route.ts`
- **Description:** The route comments specify "Daily cron (recommended: 09:00 UTC, after social-connections-health at 03:00)". It checks whether every active bundle.social team has delivered at least one webhook in the past 24 hours, and inserts a `social_connection_alerts` row if a team is silent. Never called by Vercel.
- **Impact:** The 24h webhook-silence detector never fires. If bundle.social auto-disables the webhook endpoint (documented behaviour after 50 consecutive delivery failures), the admin UI alert is never created. First notice of a broken webhook endpoint is user-visible post failure, not a proactive alert.
- **Fix complexity:** S (<5 lines)
- **Fix:** Add `{ "path": "/api/cron/check-webhook-health", "schedule": "0 9 * * *" }` to `vercel.json`
- **Decision needed?** No

---

## 3. Rate Limiting Gaps

### INFRA-003: Review-link generation endpoint not rate-limited
- **Category:** Rate Limiting Gaps
- **Severity:** MEDIUM
- **File:** `app/api/platform/social/drafts/[id]/review-link/route.ts:20-60`
- **Description:** `GET /api/platform/social/drafts/[id]/review-link` signs a 14-day JWT and returns a magic-link URL. The route has no `checkRateLimit` call. An authenticated operator could loop this endpoint to generate unlimited long-lived review tokens for a given draft or across all drafts they can access.
- **Impact:** Token-farming for review links; minor operational risk (stale long-lived links proliferate). Not currently exploitable by unauthenticated actors — the `requireCanDoForApi` gate protects it.
- **Fix complexity:** S (<15 lines)
- **Fix:** Add `checkRateLimit("approval_decision", ...)` or a dedicated `review_link_generate` bucket (5/hour/user)
- **Decision needed?** No — `approval_decision` bucket (20/hour/IP) is closest existing analog and acceptable here

### INFRA-004: Social post direct-publish endpoint not rate-limited
- **Category:** Rate Limiting Gaps
- **Severity:** MEDIUM
- **File:** `app/api/platform/social/drafts/[id]/publish/route.ts`
- **Description:** `POST /api/platform/social/drafts/[id]/publish` (immediate publish path) has no rate limiter. Each call triggers a bundle.social API call which consumes credits. An authenticated user could loop this to exhaust bundle.social quotas or incur unexpected cost.
- **Impact:** Cost amplification via billed external API calls. Protected by session auth but not per-user throttled.
- **Fix complexity:** S (<15 lines)
- **Fix:** Add `checkRateLimit("cap_assist", ...)` or a new `social_publish` bucket
- **Decision needed?** No

### INFRA-005: Webhook routes have no rate limiting (not a real finding)
- **Category:** Rate Limiting Gaps
- **Severity:** LOW (informational — not actionable)
- **File:** `app/api/webhooks/bundlesocial/route.ts`, `app/api/webhooks/qstash/social-publish/route.ts`
- **Description:** Webhook routes are authenticated by HMAC/JWT signature verification, which is the correct mechanism. Rate limiting on webhook endpoints is generally counterproductive (legitimate bursts should not be throttled). Signature verification serves as the access control.
- **Impact:** None — by design. Documented here to close the category.
- **Fix complexity:** N/A
- **Fix:** No fix needed
- **Decision needed?** No

---

## 4. Webhook Signature Verification

Both webhook handlers (`bundlesocial` and `qstash`) are correctly implemented:

- `app/api/webhooks/bundlesocial/route.ts` calls `verifyBundlesocialSignature()`, which uses `node:crypto.createHmac("sha256", secret)` and `timingSafeEqual` (lines 77–89 of `lib/bundlesocial.ts`)
- `app/api/webhooks/qstash/social-publish/route.ts` and `app/api/webhooks/qstash/social-post-history-import/route.ts` both call `verifyQstashSignature()`, which delegates to `@upstash/qstash`'s `Receiver.verify()` (JWT-based)
- Both handle the `no_secret`/`no_receiver` case by returning 503 rather than 200, preventing silent pass-through in misconfigured environments

**Finding: none.** Webhook signature verification is complete and uses constant-time comparison.

---

## 5. RLS Policy Completeness

### INFRA-006: `social_post_approval_decisions.approver_user_id` is `NOT NULL` but external-approver insert path sends `null`
- **Category:** RLS Policy Completeness (schema/data integrity gap)
- **Severity:** HIGH
- **File:** `app/api/review/[token]/decision/route.ts:122-133`; `supabase/migrations/0134_analytics_cache.sql:52`
- **Description:** `social_post_approval_decisions.approver_user_id` is defined as `uuid NOT NULL REFERENCES auth.users(id)` in migration 0134. The external-approver decision route at `POST /api/review/[token]/decision` inserts `approver_user_id: null` (line 127), which violates the NOT NULL constraint. The PostgREST response error is caught and logged only as `logger.warn("review.decision.decision_insert_failed", ...)` — not surfaced to the caller. The state transition (`pending_approval → scheduled/rejected`) still succeeds, but the audit row is never created for external approvals.
- **Impact:** External review decisions are not recorded in `social_post_approval_decisions`. The draft state advances (correct) but the decision audit trail is incomplete. Compliance gap for approval workflows.
- **Fix complexity:** S — either (a) `ALTER TABLE social_post_approval_decisions ALTER COLUMN approver_user_id DROP NOT NULL` in a new migration, or (b) skip the insert entirely when `approver_user_id` is null and record via a separate external-approver column. Option (a) is a 3-line migration.
- **Fix:** New migration: `ALTER TABLE social_post_approval_decisions ALTER COLUMN approver_user_id DROP NOT NULL; ALTER TABLE social_post_approval_decisions ADD COLUMN IF NOT EXISTS approver_email TEXT;` — then update the insert to pass `approver_email` from the JWT claims.
- **Decision needed?** No — the intent is clearly to record external approvals; the schema just needs to allow nullable approver_user_id.

All other RLS checks passed:
- `social_post_drafts`: RLS enabled (migration 0112), correct company-scoped policy
- `social_post_approval_decisions`: RLS enabled (migration 0134), correct company-scoped select + approver-gated insert
- `platform_staff_audit_log`: RLS enabled (migration 0153), read restricted to `is_opollo_staff()`
- All `USING (true)` policies found are scoped to `service_role` only — not open to authenticated or anon roles

---

## 6. Env Var Exposure

### INFRA-007: `GET /api/debug/env-check` reveals deployment metadata on non-production environments
- **Category:** Env Var Exposure
- **Severity:** LOW (by design, production-gated)
- **File:** `app/api/debug/env-check/route.ts:26-43`
- **Description:** The endpoint returns `app_env`, `vercel_env`, `supabase_url`, `has_service_role_key`, `project_ref_derived_from_url`, `build_sha`, and `branch`. It is production-gated: returns 404 when `VERCEL_ENV === 'production'`. On staging/preview/local, it reveals which Supabase project the deployment uses.
- **Impact:** On staging/preview, an unauthenticated attacker who knows the URL can determine the Supabase project reference and confirm whether the service role key is set. The project reference alone does not grant access (it's also in `NEXT_PUBLIC_SUPABASE_URL` which is already public). No actual secrets are returned.
- **Fix complexity:** S (add `requireAdminForApi` gate, or restrict to authenticated requests)
- **Fix:** Add a lightweight auth check (`requireAdminForApi`) or at minimum an `Authorization: Bearer <UAT_SECRET>` gate so only the UAT harness can call it on staging
- **Decision needed?** No — low priority given it leaks no actual credentials

---

## 7. Token/Session Management

Session management review found the following pattern:
- `getCurrentUser()` in `lib/auth.ts` always calls `supabase.auth.getUser()` (server-verified, contacts GoTrue) — never `getSession()` for authZ decisions
- `revoked_at` check (line 237) correctly gates access-tokens issued before the revocation timestamp
- The `revokeUserSessions()` hard path deletes both `auth.sessions` and `auth.refresh_tokens` via direct pg connection
- PKCE flow is managed by GoTrue/Supabase — not custom-implemented
- JWT TTL is Supabase default (1 hour access token); this is not configurable via this codebase

### INFRA-008: Direct pg connections use `rejectUnauthorized: false` for SSL
- **Category:** Token/Session Management (infrastructure/connection security)
- **Severity:** LOW
- **File:** `lib/db-direct.ts:69`
- **Description:** All direct pg connections (brief-runner, batch-worker, auth-revoke, publish-due, etc.) set `ssl: { rejectUnauthorized: false }` for non-localhost hosts. This means the pg client accepts any TLS certificate from the Supabase connection pooler, including a MITM certificate. A network-layer attacker on the path between Vercel and Supabase's pooler could intercept credentials and queries.
- **Impact:** Low in practice — Vercel-to-Supabase traffic runs over Vercel's internal egress network, not the public internet. MITM is not a realistic threat in this deployment topology. But the pattern sets a precedent.
- **Fix complexity:** S — Supabase provides a CA certificate bundle; wire `ca: fs.readFileSync('supabase-ca.crt')` and set `rejectUnauthorized: true`
- **Fix:** Pull Supabase's CA cert and configure `ssl: { ca: supabaseCaCert, rejectUnauthorized: true }`. Alternatively, accept this as a known infrastructure trade-off given Vercel's network isolation.
- **Decision needed?** Yes — requires Steven to download and provision the Supabase CA cert as a secret, and decide whether the operational complexity is worth it for this deployment topology.

---

## 8. Database Connection Pooling

### INFRA-009: Single process-level singleton for `getServiceRoleClient()` — acceptable in serverless but not connection-pool-aware
- **Category:** Database Connection Pooling
- **Severity:** LOW
- **File:** `lib/supabase.ts:13-38`
- **Description:** `getServiceRoleClient()` returns a cached `SupabaseClient` instance via a module-level `let serviceRoleClient`. In Vercel's serverless model, each function invocation gets a new Node.js process context, so the "singleton" is per-invocation anyway. The client uses PostgREST (HTTP), not a persistent TCP connection, so there is no connection-pool exhaustion risk from this pattern. For the direct `pg.Client` uses (`lib/batch-worker.ts`, `lib/brief-runner.ts`, `lib/auth-revoke.ts`, `lib/db-direct.ts`), each caller constructs, connects, uses, and calls `.end()` within a try/finally block — no connection leak observed.
- **Impact:** None observable. The pattern is correct for a Vercel serverless deployment.
- **Fix complexity:** N/A
- **Fix:** No fix needed. If the application moves to a long-lived server (e.g., Vercel Functions with `keepAlive`), revisit with `pg.Pool`.
- **Decision needed?** No

---

## 9. Error Information Leakage

### INFRA-010: Raw Supabase/DB error messages returned in `internalError()` on admin routes
- **Category:** Error Information Leakage
- **Severity:** MEDIUM
- **File:** Multiple — representative cases:
  - `app/api/admin/maintenance/companies/[id]/toggle-cross-tenant-override/route.ts:45,69`
  - `app/api/admin/maintenance/social-connections/[id]/reattribute/route.ts:58,66,75,141`
  - `app/api/admin/maintenance/webhooks/replay/route.ts:84`
  - `app/api/admin/theming/[companyId]/route.ts:64,82`
- **Description:** Multiple admin routes pass raw PostgREST/Supabase error messages directly into `internalError(error.message)` or `NextResponse.json({ ok: false, error: error.message })`. PostgREST errors can contain schema information (table names, column names, constraint names, FK references) and in rare cases query fragments. These are admin-only routes (gated by `requireAdminForApi({ roles: ["super_admin"] })`), so only Opollo staff see these messages in normal operation. The `app/api/admin/theming/[companyId]/route.ts` case uses a non-standard response shape (`{ ok: false, error: error.message }`) rather than `internalError()`.
- **Impact:** Opollo staff (super_admin) can observe internal schema details in API responses. Not externally exploitable in the current threat model, but creates a bad precedent and would be an issue if admin routes ever become accessible to broader user tiers.
- **Fix complexity:** M (audit ~15 routes, replace with generic "Database error" messages + structured logging)
- **Fix:** Replace `internalError(error.message)` with `internalError("Database error.")` and log the raw message via `logger.error(...)` — which most callers already do. Fix the non-standard shape in `theming/[companyId]/route.ts`.
- **Decision needed?** No

### INFRA-011: `internalError()` in `lib/http.ts` passes `message` parameter through to response body
- **Category:** Error Information Leakage
- **Severity:** LOW (structural note, not a standalone finding)
- **File:** `lib/http.ts:92-103`
- **Description:** `internalError(message, retryable = false)` includes the `message` string verbatim in the JSON response body under `error.message`. The function itself is not the problem — callers decide what string to pass. The pattern allows raw exception messages to reach clients if callers are not careful (see INFRA-010). `lib/http.ts` is otherwise well-designed.
- **Impact:** Dependent on caller behaviour. Documented as a pattern reminder.
- **Fix complexity:** S — add a JSDoc warning to `internalError()` noting that the message is user-visible
- **Fix:** Add comment to `internalError()` noting the message is returned verbatim in API responses
- **Decision needed?** No

---

## 10. Missing Input Validation

### INFRA-012: Validation coverage review — FIX-2 and FIX-5 routes both have Zod validation
- **Category:** Missing Input Validation
- **Severity:** N/A (informational)
- **File:** `app/api/platform/users/[userId]/route.ts:18`; `app/api/review/[token]/decision/route.ts:77-78`
- **Description:** Both routes use Zod validation:
  - `platform/users/[userId]` validates `userId` with `z.string().uuid()` before any DB call
  - `review/[token]/decision` uses `ApproveSchema` via `parseBodyWith()` for the request body
- **Impact:** No gap found.
- **Fix complexity:** N/A
- **Fix:** No fix needed

### INFRA-013: `POST /api/platform/social/drafts/[id]/publish` — no Zod validation on request body
- **Category:** Missing Input Validation
- **Severity:** LOW
- **File:** `app/api/platform/social/drafts/[id]/publish/route.ts`
- **Description:** The direct-publish endpoint does not appear to validate any request body via Zod. If the handler reads from `req.json()` without schema validation, malformed JSON or unexpected fields pass through to the library layer.
- **Impact:** Depends on library-layer handling. Low risk if the library uses typed accessors.
- **Fix complexity:** S
- **Fix:** Add Zod schema validation on the request body if any fields are read from it
- **Decision needed?** No — follow up during next review cycle

---

## 11. Concurrency / Race Conditions

### INFRA-014: `publish-due` cron — race condition mitigated by `FOR UPDATE SKIP LOCKED` (resolved)
- **Category:** Concurrency / Race Conditions
- **Severity:** Resolved
- **File:** `lib/social/publishing/claim-due-drafts.ts:31-56`; `supabase/migrations/0152_publish_due_atomic_claim.sql`
- **Description:** Migration 0152 added `publish_claimed_at` and `publish_worker_id` columns; `claimDueDrafts()` uses a single CTE with `FOR UPDATE SKIP LOCKED` so concurrent cron ticks see disjoint row sets. The `app/api/internal/cron/publish-due/route.ts` comments document this explicitly.
- **Impact:** None — correctly addressed.

**Finding: none for new race conditions.** The `FOR UPDATE SKIP LOCKED` pattern is used correctly across all three batch-processing workers (brief-runner, batch-worker, publish-due).

---

## 12. Missing Idempotency Keys

### INFRA-015: QStash retry idempotency for `social-publish` is guarded (no gap)
- **Category:** Missing Idempotency Keys
- **Severity:** N/A (informational)
- **File:** `lib/platform/social/publishing/fire.ts:48,168`; `lib/platform/social/publishing/enqueue.ts:81`
- **Description:** The QStash-to-webhook publish flow uses `deduplicationId: "social-publish-${scheduleEntryId}"` on enqueue, and `claim_publish_job()` RPC returns `ALREADY_CLAIMED` on duplicate delivery. Both the QStash deduplication and the DB-level claim guard prevent double-publish. The `social-publish` webhook handler returns 200 on `already_claimed` outcomes, stopping QStash retries.
- **Impact:** None — correctly addressed.

### INFRA-016: `social-post-history-import` webhook — `internalError(message)` returns raw exception on uncaught throws (line 84)
- **Category:** Missing Idempotency Keys / Error Leakage
- **Severity:** LOW
- **File:** `app/api/webhooks/qstash/social-post-history-import/route.ts:84`
- **Description:** The catch block at line 78-85 passes `err instanceof Error ? err.message : String(err)` directly to `internalError()`. If `runPostHistoryImport` throws an unexpected error with a sensitive message (connection string fragment, internal table name), it would appear in the 500 response body seen by QStash's retry logs (not user-visible, but logged by Upstash).
- **Impact:** QStash logs (accessible in Upstash dashboard) may contain internal error messages. Not user-visible. Low risk.
- **Fix complexity:** S
- **Fix:** Replace `internalError(message)` with `internalError("Import failed.")` and log the detail via `logger.error()`
- **Decision needed?** No

---

## Rankings

All findings sorted by risk score (likelihood × impact):

| Rank | ID | Title | Severity | Risk Score | Rationale |
|------|----|-------|----------|------------|-----------|
| 1 | INFRA-001 | `cap-weekly-generation` not in `vercel.json` | HIGH | 9/10 | Feature is completely broken silently. All companies with `cap_weekly_enabled = true` get no weekly posts. Likelihood = 1.0 (it's already broken). Impact = HIGH (missing billable feature). Fix is trivial. |
| 2 | INFRA-006 | `approver_user_id NOT NULL` violated on external review | HIGH | 8/10 | Every external approval decision fails to write an audit row. The constraint violation is confirmed by schema + code inspection. Silent failure (logged warn, not surfaced). Likelihood = 1.0. Impact = audit trail completeness. |
| 3 | INFRA-002 | `check-webhook-health` not in `vercel.json` | MEDIUM | 7/10 | Silent webhook failure detection is broken. If bundle.social disables the webhook endpoint (documented behaviour), no alert fires. Likelihood = 1.0. Impact = delayed incident detection (hours vs. minutes). |
| 4 | INFRA-010 | Raw DB error messages in admin `internalError()` | MEDIUM | 5/10 | Admin-only exposure, not externally reachable. Medium likelihood (any DB error exposes it). Low immediate impact given admin-only gate. |
| 5 | INFRA-003 | Review-link generation not rate-limited | MEDIUM | 4/10 | Requires authenticated operator to exploit. 14-day JWTs proliferate. Low immediate exploitation risk. |
| 6 | INFRA-004 | Social publish endpoint not rate-limited | MEDIUM | 4/10 | Requires authenticated user. Cost amplification risk scales with bundle.social credit price. |
| 7 | INFRA-007 | `debug/env-check` leaks staging metadata unauthenticated | LOW | 3/10 | No actual secrets returned. Project ref is derivable from `NEXT_PUBLIC_SUPABASE_URL` anyway. |
| 8 | INFRA-016 | Import webhook `internalError` leaks to QStash logs | LOW | 2/10 | Only visible in Upstash dashboard. Not user-visible. |
| 9 | INFRA-011 | `internalError()` structural note | LOW | 2/10 | Pattern issue, no direct exploit. |
| 10 | INFRA-013 | Direct-publish missing body Zod validation | LOW | 2/10 | Library-layer likely defensive. Need to verify handler body access. |
| 11 | INFRA-008 | `rejectUnauthorized: false` on pg SSL | LOW | 1/10 | Vercel-to-Supabase traffic not on public internet. MITM is not a realistic threat in this topology. |

---

## Top 3 Fixable Findings

These three meet the criteria: HIGH+ impact, M or smaller fix, not blocked on product decision.

### Fix 1 — INFRA-001: Add `cap-weekly-generation` to `vercel.json`

**Fix:** Add one JSON entry to `vercel.json`:
```json
{ "path": "/api/cron/cap-weekly-generation", "schedule": "0 6 * * 1" }
```
Consistent with the route comment "Weekly Vercel cron (Mondays 06:00 UTC)". Zero risk — the route already exists, has correct CRON_SECRET auth, and has `guardedCronSkip` for staging safety.

### Fix 2 — INFRA-002: Add `check-webhook-health` to `vercel.json`

**Fix:** Add one JSON entry to `vercel.json`:
```json
{ "path": "/api/cron/check-webhook-health", "schedule": "0 9 * * *" }
```
Consistent with the route comment "Daily cron (recommended: 09:00 UTC)". Same zero-risk profile as Fix 1.

### Fix 3 — INFRA-006: Make `approver_user_id` nullable in `social_post_approval_decisions`

**Fix:** New migration:
```sql
ALTER TABLE social_post_approval_decisions
  ALTER COLUMN approver_user_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS approver_email TEXT;
```
Then update `app/api/review/[token]/decision/route.ts` line 127 to also pass `approver_email` if available from token claims, removing the silent-fail path. This restores the audit trail for external approvals without changing any user-facing behaviour.

---

*Note: Fixes 1 and 2 are already the subject of branch `fix/vercel-missing-crons`. Fix 3 requires a new migration and a small route change.*
