# Decisions Needed

Decisions that must be made before the corresponding fix ships.
Each entry is a product or architectural choice — not a bug with an obvious correct answer.

---

## DECISION-001: What should the `user` Opollo role be allowed to do?

**Context:**
`lib/auth.ts:41` declares `Role = "super_admin" | "admin" | "user"`. The migration 0057
comment (lines 35–40) shows this was created by mapping legacy `viewer` rows to `user`,
but no admin surface checks for `user` and no route grants it. A staff member with
`role='user'` silently redirects to `/` from every page.

**Options:**
- A) **Remove the role** — drop `"user"` from the TypeScript union and add a migration
  removing it from the DB CHECK constraint. Any existing `opollo_users` rows with
  `role='user'` need to be promoted to `admin` or soft-deleted.
- B) **Define read-only surfaces for `user`** — specify which `/admin/*` sub-pages a
  `user`-role staff member can view (e.g. read-only site list, read-only company list),
  update `checkAdminAccess()` accordingly, and add those gates.
- C) **Status quo** — document that `user` is a reserved future role, no behaviour change.

**Impact if deferred:**
Any `opollo_users` row accidentally set to `role='user'` is locked out of all admin
surfaces with no explanation. Low probability but confusing when it occurs.

**Files involved:**
- `lib/auth.ts:41`
- `lib/admin-gate.ts:55`
- `supabase/migrations/` (new migration required for Option A)

---

## DECISION-002: Should bulk CSV always import as draft, or match the caller's role?

**Context:**
`app/api/platform/social/drafts/bulk/route.ts:102` hard-codes `state: "scheduled"` and
`approval_required: false`. An `editor`-role user (who lacks `schedule_post`) can upload
a CSV and bypass the approval workflow (DI-003, P0).

**Options:**
- A) **Force draft state** — all bulk imports create `state='draft'` posts. Approvers
  then review and schedule them. Clean, safe, no role check needed in the bulk handler.
- B) **Role-gated state** — check `schedule_post` permission at insert time. If the
  caller has `schedule_post`, allow `state='scheduled'`. If not, fall back to `draft`.
  Preserves existing behaviour for approver+ callers.

**Impact if deferred:**
P0 permission bypass is live. Any editor with CSV access can schedule posts without
approval. Must be resolved before next release.

**Files involved:**
- `app/api/platform/social/drafts/bulk/route.ts:95-111`

---

## DECISION-003: Are V1 (`social_post_master`) and V2 (`social_post_drafts`) permanently parallel, or is V1 being retired?

**Context:**
Two post data models coexist with incompatible state enums (DI-006, P1):
- V1 (`social_post_master`) — states: `draft`, `pending_client_approval`, `approved`,
  `rejected`, `changes_requested`, `scheduled`, `publishing`, `published`, `failed`
- V2 (`social_post_drafts`) — states: `draft`, `pending_approval`, `rejected`,
  `scheduled`, `recurring`, `paused`, `publishing`, `published`, `failed`

V1 states `pending_client_approval`, `approved`, and `changes_requested` have no V2
equivalents. V2 states `recurring` and `paused` have no V1 equivalents.

**Options:**
- A) **Permanently parallel** — V1 lives in `/company/social/posts/[id]` (old tabbed
  view); V2 lives in the composer + calendar. Document the boundary explicitly. Ensure
  no UI surface renders V1 posts through V2 state logic.
- B) **Migrate V1 to V2** — define a state mapping (`pending_client_approval →
  pending_approval`, `changes_requested → rejected`, `approved → scheduled`), write
  a data migration, retire V1 tables.
- C) **Hybrid** — new posts are V2 only; V1 posts are read-only legacy records.

**Impact if deferred:**
V1 posts in states `pending_client_approval` or `changes_requested` rendered by the V2
composer will have no matching entry in `ALLOWED_ACTIONS` and may render incorrectly.
If the calendar or composer ever loads V1 post IDs, the state machine logic will be
wrong.

**Files involved:**
- `lib/platform/social/posts/types.ts:5-14`
- `lib/social/post-state-actions.ts:20-29`
- `supabase/migrations/0070_platform_foundation.sql` (V1 schema)
- `supabase/migrations/` (new migration for Option B)

---

## DECISION-004: Should Opollo staff retain implicit write access to customer companies?

**Context:**
`lib/platform/auth/current-user.ts:112-133` — `resolveStaffCookieCompany()` returns a
synthetic `{ role: "admin" }` membership for any Opollo staff member who sets the
selected-company cookie. This grants full write access to the customer's data with no
audit log (DI-007, P1).

**Options:**
- A) **Status quo + audit log** — keep implicit admin grant, add a
  `service_access_log` table write when staff access is resolved. Low friction for
  staff; adds audit trail.
- B) **Restrict to `viewer` by default** — implicit grant becomes `viewer`. Staff who
  need write access must be explicitly added via `platform_company_users`. Requires
  checking which write operations Opollo staff legitimately need.
- C) **Restrict to `viewer` + elevated-access request** — staff can request temporary
  `admin` elevation via a confirmation step that is audit-logged.

**Impact if deferred:**
Opollo staff mutations in customer companies are indistinguishable from customer-admin
mutations. No customer visibility. Compliance risk if any customer ever requests an
audit of their account activity.

**Files involved:**
- `lib/platform/auth/current-user.ts:112-133`
- New `service_access_log` table (migration required for Options A/C)

---

## DECISION-005: Are review links intended for external (non-Opollo-account) approvers?

**Context:**
The `/review/[token]` page is secured by a JWT (DI-009, P1). However, the form
(`ReviewDecisionForm`) submits to `POST /api/platform/social/drafts/[id]/approve`, which
requires a Supabase session cookie. External approvers who do not have an Opollo account
will receive a 401 on form submit — the page looks correct but decisions fail silently.

**Options:**
- A) **Review links are internal-only** — document that review links only work for
  users who have an Opollo account and a session. The JWT is for convenience (no login
  required to *view* the post), but approvals require login. Add an explicit "Please log
  in to approve" message for unauthenticated visitors.
- B) **Review links are for external approvers** — fix the approve endpoint to accept
  the review JWT as authentication in addition to the session cookie. This requires a
  new public endpoint variant that verifies the JWT and records the decision without a
  session.

**Impact if deferred:**
Any customer who sends a review link to an external approver (e.g. a client contact
without an Opollo account) will find that the approval button silently fails. The post
stays in `pending_approval` indefinitely.

**Files involved:**
- `app/(public)/review/[token]/page.tsx`
- `components/social/review/ReviewDecisionForm.tsx:36`
- `app/api/platform/social/drafts/[id]/approve/route.ts:48`
