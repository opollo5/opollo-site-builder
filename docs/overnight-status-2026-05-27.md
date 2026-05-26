# Overnight Work Status — 2026-05-27

Four parallel tracks completed. All P0 fixes are on staging. No product
decisions were made.

---

## Track 1 — Triage Complete

**10 GitHub issues opened:** #1073–#1082
**Triage doc:** `docs/inventory/triage-plan-2026-05-27.md` (PR #1085)
**Decisions doc:** `docs/inventory/decisions-needed.md` (PR #1085)

### Triage summary

| ID | Title | Confirmed | Severity | Complexity | GitHub |
|---|---|---|---|---|---|
| DI-001 | `user` role declared but never enforced | ✅ | P2 | S | #1073 |
| DI-002 | Connect platform page is a stub redirect | ✅ | P1 | S | #1074 |
| DI-003 | Bulk CSV bypasses `schedule_post` permission | ✅ | P0 | S | #1075 |
| DI-004 | 97/100 routes missing `loading.tsx` | ✅ | P2 | M | #1076 |
| DI-005 | CLAUDE-ASSUMPTION label in production code | ✅ | P2 | S | #1077 |
| DI-006 | V1 and V2 post models coexist | ✅ | P1 | L | #1078 |
| DI-007 | Staff admin grant not audit-logged | ✅ | P1 | S–M | #1079 |
| DI-008 | CAP campaign_post has no UI affordances | ✅ | P2 | M | #1080 |
| DI-009 | Review token — external approvers get 401 | ✅ **extended** | P1 | S–M | #1081 |
| DI-010 | ApprovalToggle + schedule_post gap | ✅ | P1 | S | #1082 |

**No false positives.** All 10 confirmed.

**DI-009 extended finding:** The review JWT page renders `ReviewDecisionForm`
which calls `POST /api/platform/social/drafts/[id]/approve`. That endpoint
requires a Supabase session cookie (`requireCanDoForApi` at line 48). External
approvers without an Opollo account silently receive 401 when submitting
decisions. The review link may be shared with non-members — this is a
potential UX/security gap beyond what DI-009 originally stated.

---

## Track 2 — Two P0 Fixes Shipped to Staging

Both PRs are DRAFT targeting main. Cherry-picked to staging for immediate
UAT verification. Steven reviews and merges to main.

### Fix A — Schedule guard: 422 when no target channels (PR #1083)

**Branch:** `fix/draft-schedule-target-guard`
**File changed:** `app/api/platform/social/drafts/[id]/route.ts`

Guard added: when `mode === "schedule"` or `mode === "post_now"` and
`target_profile_ids.length === 0`, the PATCH endpoint returns:
```json
{ "ok": false, "error": { "code": "MISSING_TARGET_PROFILES", ... } }
```
HTTP 422. Placed after V2 body destructuring, before DB update.

**Regression test:** `tests/regressions/draft-schedule-requires-targets.test.ts`
- 9 test cases: 6 for the 422 path, 3 for allowed-through paths
- Fixed 2 existing unit tests in `lib/__tests__/draft-patch-v2.unit.test.ts`
  that had `target_profile_ids: []` with `mode='schedule'` (now correctly 422)
- All 2433+ unit tests pass

**UAT spec:** `e2e/uat/draft-schedule-requires-targets.spec.ts`
- 2 Playwright API tests against staging
- Skips gracefully if `STAGING_UAT_PASSWORD` unset

**Staging SHA:** `8c6bc06b` (cherry-picked)

### Fix B — Bulk CSV schedule_post permission (PR #1084)

**Branch:** `fix/bulk-csv-schedule-permission`
**File changed:** `app/api/platform/social/drafts/bulk/route.ts`

Two changes:
1. Line 31: `create_post` → `schedule_post` — editors can no longer bypass
   the approver gate via CSV upload
2. G8 fix included: per-row check in the `for` loop; if any row's channels
   resolve to `targetProfileIds.length === 0`, the entire upload is rejected
   with 400 `UNRESOLVABLE_CHANNELS` (row number in message)

**Regression test:** `tests/regressions/bulk-csv-requires-schedule-permission.test.ts`
- 10 test cases: DI-003 path + G8 path
- All 32 regression test files pass, 217/217 tests pass

**Staging SHA:** `3abb24a3` (cherry-picked)

---

## Track 3 — Inventory Enriched

**Branch:** `docs/feature-inventory-phase-1` (PR #1063 updated)
**Commit:** `bae22c73`

14 items enriched with "CURRENT BEHAVIOUR (observed in code)" sections:

| Document | Items enriched |
|---|---|
| routes-and-pages.md | 6 routes (/login, /calendar, /connections, /posts, /review/[token], /approve/[token]) |
| state-machines.md | social_post_drafts — full ASCII transition diagram + file:line citations |
| api-endpoints.md | 4 endpoints (PATCH drafts/[id], POST bulk, POST connections/connect, DELETE disconnect) |
| components-catalog.md | 4 components (ComposerOverlay, CalendarShell, PostChip, LoginForm) |

Key observations surfaced during enrichment:
- **`isTerminalForMutation()`** in `lib/social/post-state-actions.ts:81-83` is the canonical
  guard that blocks PATCH on published/publishing. The new schedule-target guard aligns
  with this pattern.
- **Optimistic CAS** on draft_version (ADR-0002 pattern) in the PATCH endpoint.
- **Hard navigation**: `LoginForm` uses `window.location.assign()` not `router.push()` —
  ensures middleware re-reads Supabase session cookies after login.
- **Cron robustness**: publish-due cron batches 10 posts, CONCURRENCY=5, MAX_PUBLISH_ATTEMPTS=3.

---

## Track 4 — Infrastructure Gap Audit (Read-Only)

**Branch:** `docs/feature-inventory-phase-1` (PR #1063 updated)
**Commit:** `d27ed749`
**Doc:** `docs/inventory/infrastructure-gaps.md`

Read-only audit across 11 categories. No code was changed. All findings are
cited with file:line.

### Summary

| Category | Top Risk | Severity |
|---|---|---|
| A. RLS / Cross-tenant | Service-role lookup before gate — TOCTOU but unexploitable | P2 |
| B. Webhook Security | No timestamp replay window on `verifyBundlesocialSignature` | P1 |
| C. Idempotency | `publish-due` cron: non-atomic SELECT+UPDATE → dual publish | **P0** |
| D. Background Jobs | `cap-weekly-generation` + `check-webhook-health` absent from vercel.json — never fire | P1 |
| E. Race Conditions | Same root as C — concurrent cron ticks, no claim lock | **P0** |
| F. Migration Safety | No rollback scripts for migrations 0035–0151 | P1 |
| G. PII / Logs | Unredacted email addresses in forgot-password logs | P1 |
| H. Session / Token | Known 2FA stale-cookie bug (tracked in project memory) | P1 |
| I. Rate Limiting | Auth routes gated; most platform social routes unprotected | P2 |
| J. Backup / DR | No documented PITR plan | P2 |
| K. Third-Party Deps | 77 bundle.social refs; contract snapshots cover ~40% of SDK surface | P2 |

**P0: 2 findings (same root — `publish-due` TOCTOU dual-publish race)**
**P1: 5 findings**
**P2: 8 findings**

### P0 — Requires a fix PR before the next high-traffic period

**`app/api/internal/cron/publish-due/route.ts:41–68`** — The cron does a
two-step SELECT then UPDATE without atomicity. Two concurrent Vercel invocations
can both SELECT the same `state='scheduled'` rows before either UPDATE completes,
resulting in both calling `publishPost` for the same post.

The QStash path is protected by `claim_publish_job` RPC with a UNIQUE DB index.
The publish-due cron path has no equivalent. The cron runs every minute with
`concurrency=5`.

**Fix sketch:** Replace the two-step SELECT+UPDATE with a single
`UPDATE social_post_drafts SET state='publishing' WHERE state='scheduled'
AND scheduled_at <= NOW() AND publish_attempts < 3 RETURNING id, ...` — or
add a Postgres function mirroring `claim_publish_job`. Both patterns exist
in the codebase (the QStash path is the working analog).

**This fix touches the publish hot path.** Steven to confirm before a fix PR
is opened (per CLAUDE.md write-safety rules).

### P1 Quick Wins (no product decision required)

1. **Add vercel.json entries** for `/api/cron/cap-weekly-generation` and
   `/api/cron/check-webhook-health` — both routes are implemented and auth-guarded
   but will never fire automatically without a schedule entry.

2. **Timestamp replay window** on `verifyBundlesocialSignature` (`lib/bundlesocial.ts:68–92`) —
   add ±5-minute `x-timestamp` header check matching QStash pattern. Check bundle.social
   spec first; if no timestamp is sent, document as accepted risk.

3. **Redact email in forgot-password logs** (`app/api/auth/forgot-password/route.ts:69,95,102`) —
   replace `email` with `email.split('@')[0] + '@...'` or a `redactEmail()` helper.

4. **Rollback scripts** for migrations 0035–0151 — 84 migrations have no rollback.
   At minimum, add rollback stubs for the 10 most recent.

---

## Decisions Needed

Before any of these tracks can produce more fixes, Steven must answer:

| Decision | Context | Blocks |
|---|---|---|
| **DECISION-001**: Should `user` role get any platform access? | `lib/auth.ts:41` declares it; no routes use it. Dead code or future intent? | DI-001 fix |
| **DECISION-002**: Should bulk CSV support drafts (not just scheduled)? | All CSV rows currently hardcoded to `state='scheduled'`. After DI-003 fix, editors can't use bulk CSV at all. | DI-003 follow-up |
| **DECISION-003**: What is the V1→V2 migration path? | V1 (social_post_master) and V2 (social_post_drafts) have incompatible state enums. | DI-006 fix |
| **DECISION-004**: Should Opollo staff writes to customer data be audit-logged? | Staff currently get implicit admin grant with no log. | DI-007 fix |
| **DECISION-005**: Should external approvers (non-Opollo accounts) be able to use review links? | `ReviewDecisionForm` requires Supabase session — external approvers silently get 401. Currently the review page is accessible; the decision form is not. | DI-009 fix |

Full context in `docs/inventory/decisions-needed.md`.

---

## Open PRs

| PR | Title | Status | Branch | Target |
|---|---|---|---|---|
| #1063 | Inventory Phase 1 (skeleton + enrichment + triage) | Draft | docs/feature-inventory-phase-1 | main |
| #1072 | Seed fix: UAT scheduled posts → draft | Auto-merge armed | staging | main |
| #1083 | fix: 422 when scheduling post with no targets | Draft | fix/draft-schedule-target-guard | main |
| #1084 | fix: bulk CSV requires schedule_post permission | Draft | fix/bulk-csv-schedule-permission | main |
| #1085 | docs: triage plan for DI-001–DI-010 | Draft | docs/inventory-triage | main |

## Staging cherry-picks

| SHA | What | Status |
|---|---|---|
| `8c6bc06b` | Schedule-target 422 guard | On staging |
| `3abb24a3` | Bulk CSV permission fix | On staging |

---

## Recommended next actions for Steven

1. **Review PR #1083** (schedule-target guard) — small, focused, needs UAT
2. **Review PR #1084** (bulk CSV permission) — small, focused, needs UAT
3. **Confirm the publish-due TOCTOU fix** (Track 4 P0) — say "go" to open PR;
   touches publish hot path so write-safety gate requires Steven's confirmation
4. **Answer DECISION-005** (external approvers) — P1 security gap, unblocks DI-009 fix
5. **Answer DECISION-002** (bulk CSV for editors) — determines if #1084 goes far enough
6. **Work through `docs/inventory/INVENTORY_README.md`** — fill EXPECTED BEHAVIOUR checkboxes in Phase 2 order (auth routes first)
7. **Merge PR #1072** (seed fix) once CI passes — already auto-merge armed
