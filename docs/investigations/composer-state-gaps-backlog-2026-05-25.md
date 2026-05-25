# Composer state-machine gaps — backlog for future PRs

Generated while implementing `feat/composer-state-aware`. Each entry
is a state-machine gap that the composer-only fix does NOT address.
These feed into the Feature Inventory tab and become individual PRs.

Severity legend: **P0** = silent data corruption or mutation of a
terminal-state row; **P1** = wrong affordance shown but no mutation
risk; **P2** = polish / consistency.

---

## G1 — Posts list filter does not gate actions by state — P1

**Surface**: `components/SocialPostsListClient.tsx` posts table on
`/company/social/posts`.

**Current**: bulk action menu offers Delete / Reschedule / Convert
to draft across mixed-state selections without per-row eligibility.

**Expected**: bulk actions should only enable on rows whose state
permits the action per `lib/social/post-state-actions.ts`. A bulk
delete that includes a `publishing` row should refuse (or skip and
report) rather than silently 409 on the server.

**Notes**: server `DELETE` already returns 409 for `published`/
`publishing` (`app/api/platform/social/drafts/[id]/route.ts:286`),
so this is UI-only.

---

## G2 — Calendar chip click handler treats every state the same — P1

**Surface**: `components/social/dashboard/PostChip.tsx` +
`components/social/dashboard/CalendarShell.tsx`.

**Current**: clicking any post chip — published, scheduled, failed —
opens the composer overlay. With this PR the composer is now state-
aware, but the chip itself does not visually differentiate (same
hover state, same click affordance). A published chip should
visually read "tap to view" rather than "tap to edit".

**Expected**: chip visual treatment derived from state (e.g.
`data-post-state` + CSS distinguishing terminal vs editable);
optional tooltip "Read-only — published 14 days ago" on hover.

---

## G3 — Bulk delete across mixed states has no per-row preview — P0

**Surface**: posts list bulk action menu (selection model in
`SocialPostsListClient.tsx`).

**Current**: "Delete N posts" message gives a count but no breakdown
by state. If the selection contains a `publishing` row, the server
will reject only that row but the user sees a generic error.

**Expected**: confirmation dialog enumerates "X drafts, Y scheduled,
Z published → Z published will only be removed from records (post
stays live on the social platform)". Driven by
`ALLOWED_ACTIONS[state]` per row.

**Why P0**: a user might assume "delete" means "delete everywhere"
on a published post — the explicit copy from the composer's
`PostInfoCard` should propagate to the bulk surface, or the bulk
action should refuse to delete published rows.

---

## G4 — Recurring / paused state transitions are not surfaced in UI — P1

**Surface**: composer + posts list.

**Current**: `state IN ('recurring', 'paused')` is a valid DB enum
value (migration 0132) but there is no UI for transitioning between
them. A user cannot pause or resume a recurring post from the
composer.

**Expected**: matrix already allows `convert_to_draft` from both
states. Add explicit `pause_recurring` / `resume_recurring` actions
to the matrix + a server transition endpoint, then expose them in
PostInfoCard.

---

## G5 — Approval-flow state transitions are not state-aware — P1

**Surface**: approval routes under
`app/api/platform/social/drafts/[id]/approve/route.ts` + composer
for `pending_approval` state.

**Current**: the matrix declares `pending_approval` → view, approve,
reject. The composer renders PostInfoCard for `pending_approval` but
there is currently no Approve/Reject button surfaced from it. The
existing approval UI lives at a separate review-link surface.

**Expected**: when the viewing user has the approver role, the
PostInfoCard for `pending_approval` should render Approve/Reject
buttons inline. Server-side `record_approval_decision` already exists
(migration 0072).

---

## G6 — Failed publish retry flow does not call a dedicated endpoint — P1

**Surface**: composer Retry button + publish path.

**Current**: this PR wires the Retry button to PATCH(mode=schedule)
which resets state from `failed` → `scheduled`. The next publish-due
cron sweep picks it up. This is a reasonable interim, but it loses
the `publish_attempts` and `last_publish_error` context that the
analytics / observability layer relies on.

**Expected**: dedicated POST
`/api/platform/social/drafts/[id]/retry-publish` that preserves the
attempt history. Matrix already declares `retry_publish` as the verb.

---

## G7 — Composer URL `?compose=<id>` does not validate row state before
fetch — P2

**Surface**: `components/composer/composer-mount-v2.tsx`.

**Current**: the mount fetches the row regardless of state. If the
draft was published, the composer hydrates fine (now read-only).
If the draft was deleted while another tab was open, the user sees
the generic `composer-fetch-error` shell.

**Expected**: when the GET response indicates the row is archived,
show "This post was deleted from Opollo" specifically, with a back-
to-calendar CTA. Today the user has to read the small print.

---

## G8 — `bulk` insert sets `state="scheduled"` without enforcement of
target_profile count — P2

**Surface**: `app/api/platform/social/drafts/bulk/route.ts:102`.

**Current**: CSV upload sets `state: "scheduled"` even when the row
has no resolved target profiles (mapper at line 89-93 can produce
an empty array if `connectionsByPlatform.get(ch)` returns
undefined). A `scheduled` row with zero target_profile_ids cannot
publish — it lives in a "stuck scheduled" state.

**Expected**: enforce target_profile_ids ≥ 1 at the bulk-row level
or fall back to `state="draft"` when empty.

---

## G9 — `convert-to-draft` endpoint only allows `scheduled` source — P2

**Surface**:
`app/api/platform/social/drafts/[id]/convert-to-draft/route.ts:39`.

**Current**: rejects every non-`scheduled` row. The matrix declares
`convert_to_draft` allowed from `recurring`, `paused`, and `scheduled`.

**Expected**: widen the source-state check to match the matrix.
Trivial change once G4 (UI for paused / recurring) lands.

---

## How to use this list

Pick one ID per follow-up PR. Lead the PR description with
`Backlog → G<N>` so the closeout maps cleanly back here. Update or
remove the row when the corresponding PR merges.

The matrix in `lib/social/post-state-actions.ts` is the load-bearing
artefact — every entry above should be resolvable by either tightening
the matrix or driving more callers through it.
