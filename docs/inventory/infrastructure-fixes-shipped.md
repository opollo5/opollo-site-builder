# Infrastructure Fixes — Shipped

**Session:** 2026-05-27 evening  
**Audited from:** `docs/inventory/infrastructure-gaps.md`  
**Scope:** Top 3 ranked findings by risk score + additional MEDIUM-severity rate-limiting gaps

---

## Top 3 HIGH-impact fixes

All three findings from the INFRA audit rankings that met the shipping criteria (HIGH impact, M or smaller complexity, no product decision needed) were addressed in **PR #1095** (`fix/di-inventory-bugs`).

| Finding | Risk Score | PR | Status |
|---------|------------|----|--------|
| INFRA-001: `cap-weekly-generation` not in `vercel.json` | 9/10 | #1095 (DI-002) | Shipped |
| INFRA-006: `approver_user_id NOT NULL` violated on external review | 8/10 | #1095 (DI-001) | Shipped |
| INFRA-002: `check-webhook-health` not in `vercel.json` | 7/10 | #1095 (DI-002) | Shipped |

**Fix details:**

- **INFRA-001 + INFRA-002**: Added two missing cron entries to `vercel.json` — `cap-weekly-generation` (Mon 06:00 UTC) and `check-webhook-health` (daily 09:00 UTC). Both routes were already implemented with correct auth; they were simply unscheduled.
- **INFRA-006**: Migration 0154 drops the `NOT NULL` constraint on `social_post_approval_decisions.approver_user_id` and adds an `approver_email TEXT` column. External-approver decision inserts no longer throw a silent constraint violation. Regression test `tests/regressions/di-001-approver-audit-trail.test.ts` verifies the null insert succeeds and the route returns 200.

---

## Track 3 additional fixes (INFRA-003, INFRA-004)

Two MEDIUM-severity rate-limiting gaps were fixed in **PR #1097** (`fix/infra-hardening-rate-limits`) as Track 3 contributions. Neither was in the original top-3 but both had S complexity and no product decision needed.

| Finding | Risk Score | PR | Status |
|---------|------------|----|--------|
| INFRA-003: Review-link generation not rate-limited | 4/10 | #1097 | Shipped |
| INFRA-004: Social publish endpoint not rate-limited | 4/10 | #1097 | Shipped |

**Fix details:**

- **INFRA-003** (`GET /api/platform/social/drafts/[id]/review-link`): Added `checkRateLimit("review_link", "ip:<x-forwarded-for>")` after the auth gate. Bucket: 10 requests/hour/IP. 14-day JWTs should not be bulk-generated; 10/hour covers all legitimate editorial use (one link per draft per approval cycle) while bounding token-farming.

- **INFRA-004** (`POST /api/platform/social/drafts/[id]/publish`): Added `checkRateLimit("social_publish", "user:<userId>")` after auth resolution. Bucket: 30 requests/hour/user. Service actors (CAP) bypass the limiter — they have their own per-company `cap_generate` bucket. User sessions are throttled to prevent runaway bundle.social API calls that accumulate credits.

Both new buckets are defined in `lib/rate-limit.ts` with documented rationale.

---

## Remaining items — not shipped this session

| Finding | Risk Score | Reason not shipped |
|---------|------------|--------------------|
| INFRA-010: Raw DB error messages in admin `internalError()` | 5/10 | Admin-only gate; not blocking. Follow-up cleanup PR. |
| INFRA-007: `debug/env-check` unauthenticated | 3/10 | No actual secrets leaked; informational only. |
| INFRA-016: Import webhook error message leakage to QStash logs | 2/10 | Not user-visible; low risk. |
| INFRA-011: `internalError()` structural note | 2/10 | Pattern issue, not an exploit. |
| INFRA-013: Direct-publish missing body Zod validation | 2/10 | Route already has `BodySchema.safeParse(body)`. Risk is low if handler reads only from parsed fields. |
| INFRA-008: `rejectUnauthorized: false` on pg SSL | 1/10 | Vercel-to-Supabase traffic is private VPC; MITM not realistic. |
| INFRA-005: Webhook rate limiting | N/A | Resolved by design; HMAC signature verification is the correct control. |
| INFRA-014: `publish-due` race condition | N/A | Resolved by migration 0152 (`FOR UPDATE SKIP LOCKED`). |
| INFRA-015: QStash retry idempotency | N/A | Resolved by existing `deduplicationId` + `claim_publish_job()` RPC. |
