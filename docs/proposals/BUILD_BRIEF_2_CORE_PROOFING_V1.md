# Build Brief 2/3 — Core Proofing V1

CONTRACT-DRIVEN AUTONOMOUS BUILD. Second of three. DEPENDS ON Brief 1 (magic-link
service). Build AFTER Brief 1 is merged + verified. Update this brief with any drift
Brief 1 reported. Execute end-to-end, one PR per logical change, migration-first.

> START WITH RECON: re-read docs/recon/PROOFING_RECON.md + Brief 1's drift report. Verify
> before building.

---

## Scope discipline (the reviewer's #1 warning)

V1 is the SIMPLE Gain-style loop. Do NOT build roles/thresholds/gatekeepers/DAM/advanced
markup — those are Brief 3 and later. V1 journey:

**Create proof → invite client (magic link) → client reviews in a queue → approve /
request changes (simple comments + region pins) → revise = NEW VERSION → re-review →
approve.**

## Locked architecture decisions (from this session)

- **Pipeline: V2.** Proofing lives on `social_post_drafts` (the active pipeline +
  publish-due cron), NOT V1 `social_post_master` (retiring). Extend the approval backbone
  to advance V2 state — the pattern already exists (Phase 1 advances batch
  `approval_status`/`workflow_state` via `onGatePass`; generalise it).
- **Versioning: introduce it for real.** No version chain exists today (recon finding 4 —
  `draft_version` is just a CAS integer). Build a true version chain now.
- Reuse the approval backbone (`social_approval_requests` etc.) — extend, don't fork
  (recon: `post_master_id` is nullable; `record_approval_decision` no-ops post state when
  null and only writes the event — so the proofing layer advances its OWN content state).
- Magic links via Brief 1's service (`purpose='approval'`).

## Step 1 — Migration: content versioning + proof linkage

On `social_post_drafts` (the content unit), add a version chain:
```
content_group_id uuid    -- stable id shared across all versions of one content item
version_number   int not null default 1
supersedes_id    uuid references social_post_drafts(id)  -- prev version (null = v1)
proof_state      text check (proof_state in
  ('draft','in_review','changes_requested','in_revision','approved','published','archived'))
```
- Backfill: each existing draft = its own `content_group_id`, `version_number=1`.
- "Revise" = create a NEW draft row: same `content_group_id`, `version_number+1`,
  `supersedes_id` = the rejected version. The old row is archived, never mutated
  (immutability of reviewed content — the PageProof discipline).
- A "proof" = the approval request (reuse `social_approval_requests`, `subject_type` gets
  a new value `'content_proof'`, `subject_id` = `content_group_id`).

## Step 2 — Proof creation + invite

- Create-proof action: takes a content draft (V2), opens a `social_approval_request`
  (`subject_type='content_proof'`), adds recipients (internal + external), issues magic
  links via Brief 1 for externals, sends the day-0 invite email (recon: this send is
  currently MISSING from `createBatchApprovalRequest` — wire it here using the §7.1
  content shape: version label, due-date-in-company-tz, reviewer role).
- Content `proof_state` → `in_review`.

## Step 3 — Client review queue (Gain front door — keep SIMPLE)

- A queue screen the magic link lands on: list of items awaiting THIS reviewer's decision,
  item opens the review screen. Batch-approve supported. This is the client's whole world
  — do not expose projects/workspaces/workflow internals.
- Reuse the existing batch-results review screen + carousel components and the
  WorkflowStatusDrawer where they fit; reuse the existing sheet/drawer primitive.

## Step 4 — Review screen (simple markup only)

- Show the content (the review surface). V1 markup = general comments + simple region
  pins on images. NO DOM selectors, NO video frame-level (Brief 3+).
- Decisions: Approve / Request changes (comment REQUIRED on request-changes, per L17,
  stored as `social_approval_events.comment_text`).
- Request changes → content `proof_state='changes_requested'` → operator revises →
  new version (Step 1) → re-review.

## Step 5 — Approve → publish handoff

- On approval (gate passes per the request's `approval_rule`), advance content
  `proof_state='approved'`, then route to the V2 publish path: set draft
  `state='scheduled'` with `scheduled_at` (apply the L16 edge cases — null→ready, past→now,
  exists→no-op, disconnected→ready+alert). The publish-due cron does the rest.

## Step 6 — Notifications (event-driven)

- Emit structured events: proof_created, reviewer_invited, proof_viewed, comment_added,
  decision_made, changes_requested, new_version, approved. Route via dispatch() + in-app.
- Reuse Phase-2 reminder ladder; external reminders now work via Brief 1's regenerate.

## Step 7 — Tests + verify
Version chain (revise = new row, old archived, chain intact); proof create + invite email
sends; external reviewer admits via magic link; approve→scheduled; request-changes→new
version→re-review; comment-required. L18 Definition of Done.

## Constraints
V2 only. Extend approval backbone, don't fork. Immutable versions. Reuse Brief 1 magic
links + dispatch() + existing UI primitives. Transactional, idempotent, preserve audit,
RLS, mirror route conventions. Keep V1 SIMPLE — defer all complexity to Brief 3.

## Report
PRs, migration prod-verified, live verification steps, drift for Brief 3.
