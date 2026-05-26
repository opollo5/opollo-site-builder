# Inventory Triage Plan — 2026-05-27

All findings verified by reading actual source files and tracing code paths.
GitHub issue numbers reference issues opened against this repo.

---

## Summary

| ID | Title | Confirmed | Severity | Complexity | GitHub Issue |
|---|---|---|---|---|---|
| DI-001 | `user` role declared but never granted or enforced | ✅ Confirmed | P2 | S | #1073 |
| DI-002 | `/company/social/connections/connect/[platform]` is a stub redirect | ✅ Confirmed | P1 | S | #1074 |
| DI-003 | Bulk CSV upload does not verify `schedule_post` permission | ✅ Confirmed | P0 | S | #1075 |
| DI-004 | Missing `loading.tsx` on 97 of 100 page routes | ✅ Confirmed | P2 | M | #1076 |
| DI-005 | `CLAUDE-ASSUMPTION` comment in production code | ✅ Confirmed | P2 | S | #1077 |
| DI-006 | V1 (`social_post_master`) and V2 (`social_post_drafts`) coexist with incompatible state enums | ✅ Confirmed | P1 | L | #1078 |
| DI-007 | Implicit Opollo staff admin grant is not audit-logged | ✅ Confirmed | P1 | S–M | #1079 |
| DI-008 | CAP `cap_campaign_posts` state machine has no UI affordances | ✅ Confirmed | P2 | M | #1080 |
| DI-009 | Review token revocation undocumented; V2 review endpoint uses session auth, not JWT | ✅ Confirmed (plus new finding) | P1 | S–M | #1081 |
| DI-010 | `ApprovalToggle` + PATCH `/drafts/[id]` lets editor disable approval requirement | ✅ Confirmed | P1 | S | #1082 |

No false positives. All 10 findings are real.

---

## Verification notes (per issue)

### DI-001

`lib/auth.ts:41` declares `Role = "super_admin" | "admin" | "user"`. Comment at lines 35–40
describes migration 0057 which maps legacy `viewer→user`, but `lib/admin-gate.ts:55` has
`ADMIN_ROLES = ["super_admin", "admin"]` — `user` is excluded. No route grants this role,
no route requires it. An `opollo_users` row with `role='user'` silently redirects to `/`.

### DI-002

`app/(platform)/company/social/connections/connect/[platform]/page.tsx:1-8` — the entire
file is a single `redirect("/company/social/connections")`. No flash, no message, no
explanation. The `CLAUDE-ASSUMPTION` comment is on line 2.

### DI-003

`app/api/platform/social/drafts/bulk/route.ts:31` — gate checks `create_post` only.
Lines 95–111 — every row in `draftsToInsert` hard-codes `state: "scheduled" as const`
and `approval_required: false`. `lib/platform/auth/permissions.ts:33` — `schedule_post`
requires `approver` minimum. An `editor`-role user uploading a CSV bypasses both the
schedule gate and the approval workflow.

### DI-004

Glob `app/**/loading.tsx` returns exactly 2 files:
- `app/(platform)/company/social/analytics/loading.tsx`
- `app/(platform)/social/poster/loading.tsx`

All other ~100 routes lack a colocated `loading.tsx`.

### DI-005

`app/(platform)/company/social/connections/connect/[platform]/page.tsx:2` contains
`// CLAUDE-ASSUMPTION (PR 1.1): ...`. Confirmed present in production code. Bundled
with DI-002 — resolved when DI-002 is addressed.

### DI-006

`lib/platform/social/posts/types.ts:5-14` — V1 `SocialPostState` includes
`pending_client_approval`, `approved`, `changes_requested`.
`lib/social/post-state-actions.ts:20-29` — V2 `PostState` has `pending_approval`,
`recurring`, `paused` but no `pending_client_approval`, `approved`, or `changes_requested`.
The two enums are genuinely incompatible. Additionally, `pending_msp_release` appears in
migrations `0097_lock_out_pending_msp_release.sql` and `0070_platform_foundation.sql` but
is absent from both type enums — a third data model fragment.

### DI-007

`lib/platform/auth/current-user.ts:112-133` — `resolveStaffCookieCompany()` returns
`{ companyId: selectedId, role: "admin" }` with no log write, no audit table insert,
no notification. The staff user ID will appear in `created_by`/`updated_by` columns but
there is no surface that flags these writes as staff access.

### DI-008

`supabase/migrations/0137_cap_phase_1_schema.sql:261` — 8 `cap_campaign_posts.status`
values: `pending`, `generated`, `approved`, `rejected`, `pushed`, `published`, `failed`,
`approved_past_due`. No retry button for `failed` posts and no cancel button for
`pending`/`pushed` posts found in any component. This is a known Phase 1 gap.

### DI-009 — extended finding

The issue is confirmed plus an additional defect was found during verification:

The `/review/[token]` JWT page renders `ReviewDecisionForm` (line 105 of the page
component). `ReviewDecisionForm` calls `POST /api/platform/social/drafts/[id]/approve`
(`components/social/review/ReviewDecisionForm.tsx:36`). That endpoint calls
`requireCanDoForApi()` (`app/api/platform/social/drafts/[id]/approve/route.ts:48`), which
requires a Supabase session cookie.

**External reviewers who do not have an Opollo account have no session cookie.** Their
form submission will receive a 401 UNAUTHORIZED. The JWT-based review link works for
rendering the page content, but the decision action is session-gated and will silently
fail for external reviewers.

The state guard at line 44 (`if ((draft.state as string) !== "pending_approval")`) is
correctly enforced — this is a partial mitigation. The token revocation concern in the
original DI-009 is valid but secondary to the broken external-approver flow.

### DI-010

`app/api/platform/social/drafts/[id]/route.ts:140` — PATCH requires only `edit_post`.
`V2SaveBodySchema` at line 105 accepts `approval_required: z.boolean().default(false)`.
Line 232 writes `approval_required` directly to the DB. No secondary `schedule_post`
gate exists. An `editor` can set `approval_required=false` and subsequently schedule
the post without approval.

---

## P0 Fix Sketches

### DI-003 — Bulk CSV bypasses `schedule_post` permission

**Working analog:** `app/api/platform/social/drafts/route.ts:84` — V2 POST uses
`requireCanDoForApi(companyId, "create_post")` for the create gate; state is set
conditionally based on `input.approval_required`.

**Diff:** The bulk route hard-codes `state: "scheduled"` and `approval_required: false`
regardless of the caller's role.

**Fix (two equivalent options):**

Option A — Force all bulk imports to `draft` state (recommended):
- `app/api/platform/social/drafts/bulk/route.ts:102` — change `state: "scheduled" as const` to `state: "draft" as const`
- `app/api/platform/social/drafts/bulk/route.ts:108` — remove `approval_required: false` (or set to company default)

Option B — Add second permission gate before insert:
```typescript
// After line 75 (batchId assignment), before draftsToInsert:
const canSchedule = await requireCanDoForApi(companyId, "schedule_post");
const bulkState = canSchedule.kind === "allow" ? "scheduled" : "draft";
```
Then use `bulkState` instead of `"scheduled"` on line 102.

Option A is preferred: bulk upload is an editorial tool, not a scheduling tool. Editors
import as drafts; approvers schedule them. Option B is a backward-compatibility shim if
some existing integration depends on bulk CSV creating scheduled posts.

**Decision needed:** Steven must choose Option A (always draft) or Option B (role-dependent state). Option A is the safe default.

---

## Recommended Fix Order

1. **DI-003** (P0, S) — Bulk CSV permission bypass. Fix in one PR, < 1 day. Regression test already scaffolded in `tests/regressions/bulk-csv-requires-schedule-permission.test.ts` on `docs/feature-inventory-phase-1`.
2. **DI-010** (P1, S) — ApprovalToggle permission gap. Fix alongside or immediately after DI-003 — same domain, same day.
3. **DI-009** (P1, S) — Review token flow broken for external approvers. Fix is small: the approve route needs a public JWT-verified path in addition to the session-gated path, or the review page needs to pass the review JWT as a bearer token.
4. **DI-007** (P1, S–M) — Staff access audit log. Add `service_access_log` write in `resolveStaffCookieCompany`. Decision on read-only restriction is separate.
5. **DI-002 + DI-005** (P1 + P2, S) — Bundle: fix the stub redirect to show a message, remove `CLAUDE-ASSUMPTION` comment.
6. **DI-006** (P1, L) — V1/V2 state enum incompatibility. Architectural decision required first.
7. **DI-001** (P2, S) — `user` role dead code. Decision required first.
8. **DI-004** (P2, M) — `loading.tsx` gaps. Incremental; start with top 10 routes.
9. **DI-008** (P2, M) — CAP state machine UI. Phase 2 CAP backlog item.

---

## Decisions Needed Before Any Fix Ships

- **DI-001:** Steven must decide whether `user` is a future role (document its intended surfaces) or dead code (remove + migration).
- **DI-003:** Steven must confirm Option A (all bulk imports become `draft`) vs Option B (role-dependent bulk state). See §"P0 Fix Sketches".
- **DI-006:** Steven must define the migration path from V1 (`social_post_master`) to V2 (`social_post_drafts`) or confirm they remain permanently parallel systems with separate UI surfaces.
- **DI-007:** Steven must decide whether Opollo staff should retain write access via implicit grant, or be restricted to read-only with explicit membership required for writes.
- **DI-009:** Steven must decide whether the review link is intended for external (non-Opollo-account) approvers. If yes, the approve endpoint needs a public JWT path. If no, the review link is internal-only and docs need to say so.

See `docs/inventory/decisions-needed.md` for full option analysis.
