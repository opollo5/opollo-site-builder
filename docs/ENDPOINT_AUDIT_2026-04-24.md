# Endpoint Behavior Audit (M15-4)

**Date:** 2026-04-24
**Scope:** All 45 `app/api/**/route.ts` handlers in the repository
**Method:** Sonnet sub-agent profiled each route (method, auth, rate limit, body parsing, external-service calls, error envelope, logging, known gotchas) + produced aggregate tables (envelope consistency, auth guard matrix, external service error handling, rate-limiting coverage, body validation, stack trace leaks, timeout surface, inconsistencies). Opus verified the two production-breaking items by reading the actual source and classified severity for each finding.
**Inputs:** `docs/_audit_scratch/code_endpoints.md` (~1700 lines, 45 route profiles + 10 aggregate sections). Scratch dir to be cleaned after M15-6.

---

## 🚨 TL;DR — two production-breaking items found, escalating

**Two active bugs** that meet Steven's "production-breaking" escalation trigger. Both are shipping in production today. Both warrant fixing ahead of the M15-7 batch.

1. **Chat route leaks internal error detail to browser clients** (`app/api/chat/route.ts:349-369`). The SSE `error` event sends raw `err.message`, error class name, and the Anthropic API error body directly to every chat user's browser. An Anthropic rate-limit response exposes quota state; a Supabase error exposes schema/constraint names; any thrown exception leaks its own message. Affects **every chat user, including non-admins**. Severity: production data disclosure.

2. **`admin/users/[id]/role` PATCH can demote the last active admin** (`app/api/admin/users/[id]/role/route.ts:146-149`). The LAST_ADMIN guard counts users by `.eq("role", "admin")` without `.is("revoked_at", null)`. If any revoked admin exists in the DB, the count includes them, and the guard permits demoting the last *active* admin. The sibling `revoke` route gets this filter right (`app/api/admin/users/[id]/revoke/route.ts:98-102`) — `role` is the drift. Severity: safety-invariant bypass under narrow conditions.

**Remaining 17 findings** span likely-production-breaking (tools route auth gaps, error-message leakage across 10+ admin routes, `retryable: true` on validation errors), latent-risk (no external-service timeouts, 30/45 routes with no structured logging, 6 unauthenticated read endpoints), and tech-debt (12 copies of `errorJson()`, 7 copies of `constantTimeEqual`).

**Escalation triggers hit:**
- [x] **Production-breaking bug found** — 2 items above, do not bury. Flagged urgently at top.
- [x] **More than 10 findings** — 19 total, pause for prioritization.
- [ ] Need external data — no.

**I am NOT starting M15-5 until you respond.**

---

## Findings summary (19 items)

| # | Severity | Category | Route(s) | One-line |
|---|---|---|---|---|
| 1 | **PROD-BREAKING** | Data disclosure | `chat` | SSE `error` event sends raw `err.message` + Anthropic API error body to browser. |
| 2 | **PROD-BREAKING** | Safety-invariant bug | `admin/users/[id]/role` | LAST_ADMIN count omits `.is("revoked_at", null)` — could allow demoting last active admin. |
| 3 | LIKELY-PROD-BREAKING | Auth gap | `tools/publish_page`, `tools/update_page`, `tools/delete_page` | No session required. WP write operations reachable by rate-limited IP when auth is off; viewer-role users can call them when auth is on. |
| 4 | LIKELY-PROD-BREAKING | Data disclosure | 10+ admin routes | Supabase/postgres `error.message` concatenated into 500 response bodies — schema names, constraint names, column names leak. |
| 5 | LIKELY-PROD-BREAKING | Retry contract break | 5 routes (`admin/images/[id]`, `admin/sites/[id]/budget`, `admin/sites/[id]/pages/[pageId]`, `admin/users/invite`, `admin/users/[id]/role`) | `retryable: true` on 400 validation errors — clients that honor the flag retry-loop forever on unfixable bad input. |
| 6 | LATENT-RISK | No timeouts | ~40 routes | Zero `AbortController`/`signal` on any external call. One hanging Anthropic/WP/Supabase/Upstash call holds a Vercel function until the 299s maxDuration. |
| 7 | LATENT-RISK | Observability gap | ~30 of 45 routes | No structured logging in route handlers. Errors surface only in Vercel raw function logs, never in Axiom. |
| 8 | LATENT-RISK | Defense-in-depth gap | 6 GET routes (`sites/list`, `sites/[id]`, `sites/[id]/design-systems`, `design-systems/[id]/components`, `design-systems/[id]/templates`, `design-systems/[id]/preview`) | No route-level auth. Relies entirely on middleware. UUID-guessing attacker with no session can read full design system CSS + composition. |
| 9 | LATENT-RISK | Rate-limiting gap | 9 sensitive routes | No rate limit on user-mgmt (revoke, reinstate, role), budget PATCH, briefs upload (10MB), design-system writes, `sites/list`, `design-systems/[id]/preview`. Abuse/spam surface. |
| 10 | LATENT-RISK | Body-validation gap | All 7 `tools/*` routes | Route passes `body: unknown` directly to executor. Whether validation happens depends on lib implementation; no route-level Zod. |
| 11 | LATENT-RISK | Auth model mismatch | All 7 `tools/*` routes | Tools executors call `runWithWpCredentials()` expecting WP creds in AsyncLocalStorage, but the tools routes don't seed that context. Direct POST bypassing chat → silent failure or default-site creds. Needs verification. |
| 12 | LATENT-RISK | Inconsistent JSON parse | Old-pattern routes | Old pattern: `try { await req.json() } catch { body = {} }` produces confusing "missing fields" error on malformed JSON. New `lib/http.readJsonBody` produces a clear "Request body must be valid JSON." error. Migration incomplete. |
| 13 | LATENT-RISK | Observability gap | `emergency` route | Uses `console.error` directly (intentional — predates logger, and may be preferred for break-glass where Axiom is the thing that's down). Emergency events do not reach Axiom. Worth formalizing. |
| 14 | TECH-DEBT | Copypasta | 12+ route files | Each has its own local `errorJson()` helper. `lib/http.ts` has `respond()` / `validationError()`. Migration incomplete. |
| 15 | TECH-DEBT | Copypasta | 7 route files (4 cron + 3 ops) | Identical 10-line `constantTimeEqual` in each. Any security fix needs a 7-place edit. |
| 16 | TECH-DEBT | Contract drift | `admin/batch/[id]/cancel` | Returns `code: "INVALID_STATE"` which is not in `ERROR_CODES` in `lib/tool-schemas.ts`. Client-side enum match fails. |
| 17 | TECH-DEBT | Undocumented auth-scope asymmetry | `admin/sites/[id]/budget` | Admin-only, while sibling `admin/sites/[id]/pages/*` routes allow admin + operator. Probably intentional (budget = financial), but undocumented. |
| 18 | TECH-DEBT | Envelope outlier | `health` | Response is `{ status, checks, build, timestamp }` — no `ok` field. Clients using `result.ok` to branch will be wrong. Probably fine for a health probe; flag for consistency-conscious review. |
| 19 | TECH-DEBT | Unhandled sub-call | `health` | `Promise.all([checkSupabase(), checkBudgetResetBacklog()])` has no outer try/catch. If either helper throws (not returns error-shaped), Next.js returns an unstructured 500. |

---

## Urgent — the two production-breaking findings

### 1. Chat route leaks internal error detail to browser clients

**File:** `app/api/chat/route.ts`, lines 346-369

**Code (abridged):**
```ts
} catch (err) {
  const apiErr = err instanceof Anthropic.APIError ? err : null;

  const diagnostic = {
    model: MODEL,
    message: err instanceof Error ? err.message : String(err),
    name: err instanceof Error ? err.name : undefined,
    status: apiErr?.status,
    request_id: apiErr?.requestID,
    body: apiErr?.error,
    stack: err instanceof Error ? err.stack : undefined,
  };
  logger.error("api.chat.streaming_error", diagnostic);

  send("error", {
    code: "INTERNAL_ERROR",
    message: diagnostic.message,     // ← raw error message
    details: {
      name: diagnostic.name,          // ← error class name
      status: diagnostic.status,
      request_id: diagnostic.request_id,
      body: diagnostic.body,          // ← Anthropic API error body
    },
  });
}
```

**What leaks:**
- `message`: raw `err.message`. For an Anthropic `APIError`, this contains the SDK's stringified response (rate-limit info, quota state, model descriptors). For a Supabase/postgres error, it contains SQL error text with table/column/constraint names. For an uncaught `TypeError`, whatever the JS runtime produced.
- `details.body`: the raw Anthropic error payload. This is the SDK's `error` property — structured, often including request IDs and per-error-type fields.
- `details.name`: error class name (e.g., `RateLimitError`, `AuthenticationError`).

**Note:** `diagnostic.stack` is *logged* (to Axiom via `logger.error`) but *not* sent in the SSE. That part is clean. The payload shown above IS sent to the browser.

**Who sees it:** every user of the chat interface, including viewer-role users and unauthenticated users when `FEATURE_SUPABASE_AUTH` is off. SSE is a long-lived browser connection; the error event is displayed by whatever client-side code handles `event: error`.

**Why it matters:** standard information-disclosure surface. Not credential leakage, but infrastructure detail: which models we use, our rate-limit state with Anthropic, our database schema. All of which attackers use for reconnaissance.

**Fix options:**
- **(a) Sanitize the SSE payload.** Keep the full diagnostic in the server log; send only `{ code: "INTERNAL_ERROR", message: "Generation failed. If this persists, contact support.", request_id: diagnostic.request_id }` to the browser. `request_id` is safe (it's ours) and is the key operators need to find the full diagnostic in Axiom.
- **(b) Classify error and send a safe code per class.** E.g., `ANTHROPIC_RATE_LIMIT` if `apiErr.status === 429`, `ANTHROPIC_AUTH` if 401/403, `INTERNAL_ERROR` otherwise. No free-text message; static per-code copy. More work, but gives clients something actionable.

Recommend (a) for the immediate fix, (b) as a follow-up slice if product wants retry-aware chat UX.

---

### 2. `admin/users/[id]/role` PATCH LAST_ADMIN guard is missing the `revoked_at` filter

**File:** `app/api/admin/users/[id]/role/route.ts`, lines 146-149

**Code:**
```ts
const { count, error: countErr } = await svc
  .from("opollo_users")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin");
// ← missing: .is("revoked_at", null)
```

**Compare — sibling `revoke` route does it right** (`app/api/admin/users/[id]/revoke/route.ts:98-102`):
```ts
const { count, error: countErr } = await svc
  .from("opollo_users")
  .select("id", { count: "exact", head: true })
  .eq("role", "admin")
  .is("revoked_at", null);   // ← correct
```

**What breaks:** the guard on line 157 (`if ((count ?? 0) <= 1) return LAST_ADMIN`) checks whether we'd be demoting the last admin. If the DB has, say, 1 active admin + 1 revoked admin, `count` returns 2, the guard passes, and demoting the active admin leaves the system with *zero* active admins — exactly the state the guard is meant to prevent.

**Exploit window:** requires at least one `opollo_users` row with `role='admin'` and `revoked_at IS NOT NULL`. Current DB state unknown from the audit. The `revoke` path sets `revoked_at` without clearing `role`, so any previously-admin user who's been revoked makes the drift live.

**Fix:** add `.is("revoked_at", null)` to the query. One-line change. Also worth auditing the other `count.admin` sites — there might be more.

This is the *same* class of bug (`deleted_at` vs `revoked_at` confusion) that produced the M14-1 incident which kicked off the whole M15 audit series. Same lesson, different route.

**Fix options:**
- **(a) Add the missing filter.** One-line change. Land now.
- **(b) Centralize the query.** Create `countActiveAdmins()` in `lib/auth.ts` or similar; both routes call it. Prevents future drift.

Recommend (b) — the root cause is a copypasta of the count query. Fixing both routes to call one helper closes the drift surface.

---

## Likely-production-breaking

### 3. Tools write routes have no session requirement

**Routes:** `app/api/tools/publish_page/route.ts`, `app/api/tools/update_page/route.ts`, `app/api/tools/delete_page/route.ts`

Session is optional (rate-limited by user-id if present, else by IP). When `FEATURE_SUPABASE_AUTH` is off (kill-switch path), any IP that can stay under the `tools` rate limit (120 req/60s shared with 4 other tools routes) can POST a valid body and trigger WP write operations. When auth is on, any role — viewer included — can call them.

**Mitigating factor:** the tools routes also have a latent bug (finding #11) where `runWithWpCredentials()` isn't seeded in the route, so direct calls may fail silently or use default-site creds. Need to trace through `lib/create-page.ts` etc. to confirm what happens to a direct call outside the chat flow. But "the attack doesn't work because of another bug" is not a security argument.

**Fix:** add `requireAdminForApi(['admin', 'operator'])` to the three write routes. The `tools/*` endpoints are internal to the chat flow; no external caller needs them. If there IS an external caller (tests?), switch those to admin-session or a separate internal-auth mechanism.

### 4. Error-message leakage in 500 responses across 10+ admin routes

Every admin route that does `errorJson("INTERNAL_ERROR", `Failed to X: ${err.message}`, 500)` leaks raw Supabase/postgres error text. Found in:

- `admin/users/invite` (1 site)
- `admin/users/list` (1 site)
- `admin/users/[id]/reinstate` (3 sites)
- `admin/users/[id]/revoke` (4 sites)
- `admin/users/[id]/role` (3 sites)
- `admin/batch/[id]/cancel` (3 sites)
- `account/change-password` (1 site)
- `auth/reset-password` (1 site)
- `briefs/upload` (formData parse error path)

Supabase errors include table names, constraint names, column names, sometimes row data hints. Postgres `error.message` can include SQL snippets. All of this is reconnaissance gold and violates the CLAUDE.md observability contract ("no leaked stack traces, consistent envelope").

**Fix:** replace each `Failed to X: ${err.message}` with a generic message + `logger.error()` the full diagnostic with the request_id. One-PR fan-out.

### 5. `retryable: true` on validation errors

Routes: `admin/images/[id]`, `admin/sites/[id]/budget`, `admin/sites/[id]/pages/[pageId]`, `admin/users/invite`, `admin/users/[id]/role`.

Pattern: these routes return `{ ok: false, error: { code: "VALIDATION_FAILED", retryable: true, ... } }` on a Zod parse failure. `retryable: true` means "try again with the same input" — wrong for a validation error; correct retry is "try again with fixed input." Clients that auto-retry on `retryable` loop forever.

**Fix:** force `retryable: false` on all `VALIDATION_FAILED` responses. Centralize via `lib/http.validationError()` (which already gets this right). Migrate the 5 holdouts.

---

## Latent-risk (8 items)

### 6. Zero timeouts on external calls

None of the 45 routes configure an `AbortController`, `signal`, or SDK-level timeout on Anthropic, WordPress, Supabase, or Upstash calls. The only exception is `ops/self-probe` which uses `Sentry.flush(5000)`.

**Blast radius:** a hanging Anthropic or WordPress call holds a Vercel function slot until Next.js maxDuration (typically 299s). Under load, draining function concurrency can cascade into timeouts for unrelated requests.

**Fix:** introduce a shared `withTimeout(promise, ms)` helper in `lib/http.ts`. Wrap each external call. Suggested initial values: Anthropic 60s, WordPress 30s, Cloudflare 30s, Supabase 15s. Emit `EXTERNAL_TIMEOUT` on exceedance.

### 7. ~30 of 45 routes have no structured logging

Routes that handle errors without calling `logger.error/warn/info` at all: admin/batch, admin/batch/[id]/cancel, admin/images/[id], admin/images/[id]/restore, admin/sites/[id]/budget, admin/sites/[id]/pages/[pageId], admin/sites/[id]/pages/[pageId]/regenerate, admin/users/list, admin/users/[id]/reinstate, admin/users/[id]/revoke, admin/users/[id]/role, briefs/upload (partial), auth/callback, all design-systems/*, sites/register, sites/[id], sites/[id]/design-systems, sites/list, all 7 tools/*.

Errors on these surfaces appear only in Vercel raw function logs (ephemeral, no index) — not in Axiom's queryable store. Per CLAUDE.md observability contract, production paths should log via `lib/logger`.

**Fix:** on every error-return path in these routes, call `logger.error()` with the error code + request_id + context. Incremental — can be done per-route without breaking anything.

### 8. Defense-in-depth gap: 6 public GET routes

`sites/list`, `sites/[id]`, `sites/[id]/design-systems`, `design-systems/[id]/components`, `design-systems/[id]/templates`, `design-systems/[id]/preview` have no route-level auth. Middleware is the only gate. If middleware matcher is ever misconfigured or the Basic Auth kill-switch flips open, these become anonymous reads.

**Fix:** add `requireAdminForApi()` with whatever role set matches current middleware intent. Cost: one import + one check per route. Value: every route enforces its own auth; middleware becomes a defense layer, not the defense layer.

### 9. Rate-limiting gaps on sensitive admin routes

Routes that should probably be rate-limited but aren't: user-mgmt (revoke/reinstate/role), budget PATCH, briefs upload (accepts up to 10MB), design-system writes, `sites/list`, `design-systems/[id]/preview`. The `rate-limit.ts` file already anticipates more buckets; wiring is just not done.

**Fix:** add named buckets (`user_mgmt`, `admin_write`, `briefs`) and wire each route. Low-cost.

### 10. Tools routes delegate body validation entirely

All 7 `tools/*` routes pass `body: unknown` to the executor with no route-level Zod check. Whether validation happens depends on `lib/create-page.ts` etc. This is fragile — a refactor of a lib function that removes validation silently removes the guard.

**Fix:** add a Zod schema at the route for each tools action. The tool-schemas are already defined in `lib/tool-schemas.ts`; call `parseBodyWith(req, toolSchemas.createPage)`.

### 11. Tools routes don't seed `runWithWpCredentials()` context

Tools executors (`executeCreatePage`, `executePublishPage`, etc.) call `runWithWpCredentials()` expecting site credentials in AsyncLocalStorage. The chat route seeds that context with `getSite()` credentials; the tools routes do not. A direct POST to `/api/tools/publish_page` bypassing chat → either silent failure (no creds, WP publish returns 401 and the executor maps it to an error) or, worse, uses some default-site credentials from a prior request. Needs verification.

**Fix:** two paths — (1) remove the tools routes if they're only used internally by chat (chat calls the executors directly, not through HTTP); or (2) keep the routes and seed the context from the request body's `site_id`. Probably (1) — the tools routes appear vestigial from an earlier architecture where a separate agent front-end called them.

### 12. Malformed JSON behavior inconsistent

Old pattern: `try { body = await req.json() } catch { body = {} }`. A malformed JSON body becomes `{}`, validation then fails with "missing fields" — confusing diagnostic.

New pattern (`lib/http.readJsonBody`): returns `undefined`, `parseBodyWith` emits "Request body must be valid JSON."

**Fix:** migrate old-pattern routes to `readJsonBody` + `parseBodyWith`. Lands alongside the envelope-helper migration (finding #14).

### 13. Emergency route `console.error` doesn't reach Axiom

`app/api/emergency/route.ts:106` uses `console.error("[emergency]", JSON.stringify(...))` with an eslint-disable. Rationale (presumably): the break-glass path must not depend on the logger, since the logger depends on Axiom and Axiom may be the thing that's down.

**Consequence:** emergency route invocations don't flow to Axiom's indexed store. Vercel raw function logs only. Operators investigating a break-glass event have to know to look there.

**Fix options:** (a) dual-log — call both `logger.error` and `console.error`, accepting the cost if logger throws. (b) accept the status quo, add a `docs/RUNBOOK.md` pointer to "where to find emergency events." (c) write emergency events to a dedicated DB table (append-only audit) in addition to stdout.

Recommend (b) for now — it's cheap, and the status quo is defensible.

---

## Tech-debt (6 items)

### 14. 12+ local `errorJson()` helpers

Routes that use an inline `errorJson()` helper (Sub-variant A2 in the envelope analysis) each define their own copy. `lib/http.ts` has `respond()` / `validationError()` for the same purpose (Sub-variant A1). Functionally identical today; fragmentation means a future change to the envelope requires 12 edits.

**Fix:** migrate A2 routes to `lib/http.ts` helpers. Large diff but mechanical.

### 15. `constantTimeEqual` duplicated 7 times

Identical 10-line function in cron/budget-reset, cron/process-batch, cron/process-regenerations, cron/process-transfer, emergency, ops/reset-admin-password, ops/self-probe.

**Fix:** move to `lib/http.ts` (or a new `lib/crypto-compare.ts`); import where needed.

### 16. `INVALID_STATE` error code not in `ERROR_CODES` enum

`admin/batch/[id]/cancel` returns `code: "INVALID_STATE"` on a wrong-state cancel attempt, but `ERROR_CODES` in `lib/tool-schemas.ts` doesn't include it. Client-side enum matching fails silently. Likely no client actually matches on this today, but the contract is broken.

**Fix:** add `"INVALID_STATE"` to the enum, or rename to an existing code.

### 17. Auth-scope asymmetry on `admin/sites/[id]/budget`

Admin-only while sibling `admin/sites/[id]/pages/*` allows admin + operator. Probably intentional (budget caps are financial; operators edit content). Not documented in either route or in CLAUDE.md.

**Fix:** add a comment at the `requireAdminForApi(['admin'])` call explaining why operators are excluded from this specific route.

### 18. `health` envelope non-standard

No `ok` field. Intentional for a health probe shape (`{ status, checks, build, timestamp }`). But any client expecting `result.ok` will be wrong. Marginal — few clients call `/api/health` programmatically.

**Fix:** document in the route-level comment, or align to `{ ok, data: { status, checks, build }, timestamp }`. Low priority.

### 19. `health` route has no outer try/catch

`Promise.all([checkSupabase(), checkBudgetResetBacklog()])` — if a helper throws (not returns error-shaped), Next.js emits an unstructured 500. Probably never happens in practice, but belt-and-braces.

**Fix:** wrap in try/catch; on failure, return a 503 with the standard check-level error surface.

---

## Cross-cutting patterns

### Response-envelope drift

One canonical envelope (`{ ok, error?, data?, timestamp }`), two implementations (A1 via `lib/http.respond()`, A2 via inline `errorJson()` in each route file). 12+ copies of A2. `health` and `self-probe` are documented outliers; `chat` is dual-mode (JSON pre-stream, SSE in-stream). One migration slice could unify A2 → A1.

### Logging gap

~30 of 45 routes have no structured logging. The observability contract says "use `lib/logger`"; the practice says "many routes log nothing." This is the single biggest observability hole in the codebase.

### Timeout gap

Zero `AbortController` usage on external calls. Exactly one explicit timeout anywhere (`Sentry.flush(5000)` in `ops/self-probe`). This is a Vercel-function-concurrency risk, not just a correctness risk — a slow upstream can drain the pool.

### Rate-limit gap

9 sensitive routes without a limiter. The `lib/rate-limit.ts` file's comments anticipate more buckets; wiring is incomplete.

### Copypasta

12 `errorJson()` copies + 7 `constantTimeEqual` copies. Migration-ready: both have canonical homes in `lib/http.ts`.

### Auth-layering

Middleware is the *only* route-level gate on 6 read routes. Defense in depth missing.

---

## What I did NOT cover in this audit

- **Live endpoint probing.** This is static analysis of route handlers. I didn't call any endpoint to verify behavior against a running deployment. The M15-1 in-flight `/api/ops/reset-admin-password` work should exercise one of these paths live; that's their territory.
- **Middleware-level auth review.** Middleware was read for context but not audited in depth. `middleware.ts` is listed as a "hot-shared" file in `docs/WORK_IN_FLIGHT.md`; changes need the coordination protocol.
- **Request-handling correctness below the route layer.** The `lib/*.ts` implementations that routes delegate to weren't audited here. If `executeCreatePage()` has its own auth check inside, some of the tools-route findings are less severe than they look. Spot-check when fixing.
- **M15-5 territory.** Hardcoded URLs, cron timezone/overlap, race conditions, dead code, RLS bypass paths, promise-rejection handling — all belong in the cross-cutting production-risk audit. A few observations here (timeout gap, rate-limit gap) will also surface there; I'll avoid re-flagging.

---

## Files produced

- `docs/ENDPOINT_AUDIT_2026-04-24.md` (this file)
- `docs/_audit_scratch/code_endpoints.md` (~1700 lines, raw Sonnet output — kept for M15-5/6 reuse)
- `docs/_audit_scratch/_extract2.js` (one-shot JSON extractor; safe to delete after M15-6)

---

## Awaiting review

Two paths forward:

**Option A — fix the two production-breaking items now** (same shape as the M15-3 fix PR). Small, targeted, ~1 day:
- Sanitize the chat SSE error payload (finding #1).
- Add `.is("revoked_at", null)` to `admin/users/[id]/role` LAST_ADMIN count — ideally via a shared `countActiveAdmins()` helper that `revoke` also calls (findings #2 + a latent copypasta cleanup).
- Add unit tests for both.

**Option B — defer everything to M15-7** and continue through M15-5 + M15-6 first.

Option A matches how you scoped M15-3. The two items are narrow, well-understood, and both reduce a real risk in production today. My recommendation is A, but this is your call given the pause rule.

Same pause question as M15-2 and M15-3: which findings escalate into immediate fixes, and do I proceed to M15-5?
