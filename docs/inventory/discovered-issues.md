# Discovered Issues Inventory

Generated: 2026-05-27  
Auditor: Claude Code (automated)  
Scope: Permission/auth gaps, token lifecycle, state machine divergence, RLS completeness,
rate limiting, validation, cron auth, cross-tenant boundaries.

Already-shipped (skip these numbers):
- **DI-003**: Bulk CSV requires schedule_post permission — fixed in PR #1084  
- **DI-007**: Implicit staff admin grant audit logging — fixed in PR #1091  
- **DI-010**: ApprovalToggle gate used edit_post instead of approve_post — fixed in PR #1092  

---

## DI-001: External approval decision inserts null into NOT NULL column — audit row always fails

**Severity:** HIGH  
**Category:** data-integrity  
**File:** `app/api/review/[token]/decision/route.ts:125-130`  
**Description:** The external-approver decision endpoint (the public magic-link flow) inserts
`approver_user_id: null` into `social_post_approval_decisions`. The DB schema defines that
column as `uuid NOT NULL` (migration `0134_analytics_cache.sql:52`). Every external approval
or rejection causes a constraint violation. The error is swallowed with `logger.warn` and the
state transition still succeeds, so the approver sees a success response — but no audit row is
ever written. The approval decision is completely untraceable for any post reviewed via the
external link path.  
**Impact:** Every post approved or rejected via the external review link has no audit trail in
`social_post_approval_decisions`. Compliance and dispute resolution are impossible for these
decisions.  
**Fix:** Add `ALTER TABLE social_post_approval_decisions ALTER COLUMN approver_user_id DROP NOT
NULL` in a new migration (external approvers have no platform user ID by design), and add a
separate `approver_email text` column to capture identity for the external path.  
**Status:** OPEN

---

## DI-002: Two cron routes missing from vercel.json — never invoked in production

**Severity:** HIGH  
**Category:** data-integrity  
**File:** `vercel.json` (missing entries); routes at `app/api/cron/cap-weekly-generation/route.ts`
and `app/api/cron/check-webhook-health/route.ts`  
**Description:** Two authenticated cron handler files exist in the codebase but have no
corresponding entry in `vercel.json`, so Vercel never schedules them. `cap-weekly-generation`
is the weekly CAP draft generation for companies where `cap_weekly_enabled = true`; its
comment declares `Mondays 06:00 UTC`. `check-webhook-health` is a daily check for whether
bundle.social webhooks are silent (bundle.social auto-disables after 50 consecutive failures).
Both handlers are fully implemented, authenticated, and tested — they just never fire.  
**Impact:** Companies with `cap_weekly_enabled = true` receive no weekly posts. Silent webhook
outages go undetected until a user notices posts stopped publishing.  
**Fix:** Add two entries to `vercel.json`:
`{ "path": "/api/cron/cap-weekly-generation", "schedule": "0 6 * * 1" }` and
`{ "path": "/api/cron/check-webhook-health", "schedule": "0 9 * * *" }`.  
**Status:** OPEN

---

## DI-004: Internal draft approve endpoint missing optimistic concurrency guard — TOCTOU race

**Severity:** HIGH  
**Category:** data-integrity  
**File:** `app/api/platform/social/drafts/[id]/approve/route.ts:74-77`  
**Description:** The authenticated internal approve route reads `draft.state` at line 44 and
rejects if it is not `"pending_approval"`. However, the subsequent UPDATE at line 74 does NOT
filter on `state`:
```
.update({ state: newState, ... })
.eq("id", idCheck.value)   // no .eq("state", "pending_approval")
```
If two approvers submit decisions concurrently (e.g., the named approver and a company admin),
both read `state = "pending_approval"`, both pass the check, and both UPDATE succeeds — the
last write wins. The result: `social_post_approval_decisions` contains two conflicting rows
(e.g., `approved` then `rejected`), and the final state in `social_post_drafts` is whichever
ran last — potentially overwriting an approved post with a rejection.

Compare with the external review route at `app/api/review/[token]/decision/route.ts:113-115`
which correctly uses `.eq("state", "pending_approval")` as the concurrency guard.  
**Impact:** Under concurrent approval (rare but possible in approval-required workflows), a post
can end up rejected despite having been approved, or vice versa, with a corrupt audit trail.  
**Fix:** Add `.eq("state", "pending_approval")` to the UPDATE call at line 77, then check
`updateErr` or affected row count (0 rows = already decided → return 409 ALREADY_DECIDED),
matching the external review pattern.  
**Status:** OPEN

---

## DI-005: Review link generated for drafts in any state — misleading link dispatched for non-pending drafts

**Severity:** MEDIUM  
**Category:** permission  
**File:** `app/api/platform/social/drafts/[id]/review-link/route.ts:32`  
**Description:** The review-link generation endpoint selects `company_id` and `state` from the
draft but never validates that `state === "pending_approval"` before issuing a JWT token.  
An editor can generate (and email) a review link for a draft in `rejected`, `published`,
`scheduled`, or `failed` state. The external approver who receives it can load the review page,
see the post content, and attempt to approve/reject — but will receive a 409 (ALREADY_DECIDED)
from `app/api/review/[token]/decision/route.ts:95-107`. No state change occurs. However:
1. Post content is exposed to an external recipient after the post lifecycle has ended.
2. The approver is confused by a misleading review link that cannot do anything.
3. A review link can be generated for an `archived_at != null` draft (soft-deleted), since the
   query at line 30 also does not filter on `archived_at`.  
**Fix:** Add a state check after fetching the draft: return 409 (with a descriptive message) if
`draft.state !== "pending_approval"`. Also add `.is("archived_at", null)` to the query.  
**Status:** OPEN

---

## DI-006: Link-preview endpoint fetches arbitrary URLs without SSRF guard

**Severity:** HIGH  
**Category:** auth  
**File:** `app/api/platform/social/link-preview/route.ts:108-122`  
**Description:** The link-preview endpoint validates only that the user-supplied URL uses
`http:` or `https:` protocol before calling `fetch(normalizedUrl, ...)`. There is no check
against private/reserved IP ranges (127.0.0.1, 169.254.169.254 — AWS/GCP metadata, ::1,
10.x, 172.16–31.x, 192.168.x). An editor with `edit_post` permission can therefore use this
endpoint as an SSRF proxy to:
- Read AWS instance metadata (`http://169.254.169.254/latest/meta-data/`)
- Probe internal Vercel infrastructure or other services reachable from the edge function

The codebase already has a working SSRF guard (`lib/ssrf-guard.ts`) with `assertSafeUrl()`,
and it is used by the analogous image-fetch endpoint at
`app/api/admin/images/fetch-url/route.ts:66`. The link-preview route does not call it.  
**Impact:** Any user with `edit_post` permission (all editors, approvers, admins) can exfiltrate
cloud metadata credentials or probe internal services.  
**Fix:** Call `await assertSafeUrl(parsed.href)` before the `fetch` at line 145, catching
`SsrfBlockedError` and returning 422. This matches the working analog in
`app/api/admin/images/fetch-url/route.ts:64-70`.  
**Status:** OPEN

---

## DI-008: V1 (social_post_master) and V2 (social_post_drafts) state machines use different state names with no mapping guard

**Severity:** MEDIUM  
**Category:** state  
**File:** `lib/platform/social/posts/types.ts:5-14` vs `lib/social/types.ts:19-29`  
**Description:** Two parallel state machines are in production for social posts:

| V1 (`social_post_master.state`, DB enum) | V2 (`social_post_drafts.state`, text + CHECK) |
|---|---|
| `pending_client_approval` | `pending_approval` |
| `approved` | *(no intermediate approved state)* |
| `changes_requested` | *(not present)* |
| `pending_msp_release` | *(not present)* |
| `recurring` | *(not present in V1)* |
| `paused` | *(not present in V1)* |

The V1 `social_post_state` is a Postgres `ENUM` (`0070_platform_foundation.sql:123-134`).
The V2 state is a `text` column with a CHECK constraint (`0132_planned_for_at.sql:19-31`).

Code paths that mix both systems can silently route to the wrong state machine. Specifically,
the `drafts/[id]/publish/route.ts` calls `approvePost()` from the V1 library
(`lib/platform/social/posts`) on a V2 draft's derived `post_master` — this is intentional and
documented. However, TypeScript types for the two systems share the `state` field name but
accept disjoint literal unions. Any generic code that handles `state` across both systems (e.g.,
display components, filter queries, analytics) can silently diverge.

**Decision needed:** Is V1 intended to be deprecated in favour of V2, and if so, what is the
migration path? This divergence should be resolved by either: (a) a migration that aligns the
V2 state names to V1 (or vice versa), or (b) explicit documentation + TS discriminated union
that prevents any code from treating both shapes identically.

---

## DI-009: social_post_approval_decisions has no UPDATE/DELETE RLS policy — append-only at application layer only

**Severity:** MEDIUM  
**Category:** rls  
**File:** `supabase/migrations/0134_analytics_cache.sql:69-91`  
**Description:** The `social_post_approval_decisions` table has two RLS policies:
- `select_own_company` — SELECT for company members
- `insert_as_approver` — INSERT where `approver_user_id = auth.uid()`

There is no UPDATE or DELETE policy, which means no authenticated user can update or delete
rows via PostgREST directly. This is the intended append-only audit design. However:

1. The `insert_as_approver` policy's `WITH CHECK` condition requires `approver_user_id =
auth.uid()`, which is correct for direct client inserts. But all actual inserts happen via
`getServiceRoleClient()` (which bypasses RLS). The RLS INSERT policy therefore provides no
protection — any authenticated user could in principle use the Supabase anon/authed client to
insert a row naming *any* `approver_user_id` as long as they are a company member.

2. There is no RLS policy preventing a company `admin` from inserting a fake decision row via
direct Supabase client access (e.g., in a custom script or via the Supabase dashboard) that
attributes approval to another user.

**Fix:** Change the `insert_as_approver` policy to only permit inserts from `service_role` (i.e.,
remove the authenticated INSERT policy entirely since no real path uses it, and all inserts go
via service role). This matches the pattern used for `social_post_analytics_cache` in the same
migration (no INSERT policy for authenticated users at all).  
**Status:** OPEN

---

## Summary

| # | Title | Severity | Status |
|---|---|---|---|
| DI-001 | External approval decision always fails to write audit row | HIGH | OPEN |
| DI-002 | Two cron routes missing from vercel.json | HIGH | OPEN |
| DI-003 | Bulk CSV requires schedule_post permission | — | SHIPPED (#1084) |
| DI-004 | Internal draft approve missing concurrency guard (TOCTOU race) | HIGH | OPEN |
| DI-005 | Review link generated for non-pending drafts | MEDIUM | OPEN |
| DI-006 | Link-preview SSRF — no private-IP guard | HIGH | OPEN |
| DI-007 | Implicit staff admin grant audit logging | — | SHIPPED (#1091) |
| DI-008 | V1/V2 state machine divergence | MEDIUM | OPEN (decision needed) |
| DI-009 | approval_decisions INSERT RLS policy is ineffective | MEDIUM | OPEN |
| DI-010 | ApprovalToggle gate used edit_post instead of approve_post | — | SHIPPED (#1092) |
