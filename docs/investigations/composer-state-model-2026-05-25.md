# Composer state-model investigation — 2026-05-25

Bug: every post opens in fully-editable mode regardless of `state` —
including posts already published to LinkedIn weeks ago.

## 1. State enum

Source of truth: `supabase/migrations/0132_planned_for_at.sql:18-31` —
`social_post_drafts.state` CHECK constraint:

```sql
CHECK ( state IN (
  'draft', 'pending_approval', 'rejected', 'scheduled',
  'recurring', 'paused', 'publishing', 'published', 'failed'
))
```

Mirrored in TypeScript at `lib/social/types.ts:19-28` as `DraftState`.

The brief lists `needs_approval`; the actual column value is
**`pending_approval`** — using the DB value.

## 2. Composer behaviour per state today

Single entry path: `components/composer/composer-mount-v2.tsx` mounts
`ComposerOverlay` on `/company/social/*` when `?compose=<id>` is set
(`composer-mount-v2.tsx:135-141`). The mount fetches the draft and
passes the row's `state` as `editOriginalState`
(`composer-mount-v2.tsx:189-191`).

`components/social/composer/ComposerOverlay.tsx` consumes
`editOriginalState`:

| Branch | Where | What it does |
|---|---|---|
| `publishing` | `ComposerOverlay.tsx:448, 599` | `isSubmitDisabled` forced true; body gets `pointer-events-none opacity-60`; "Publishing…" pill in header |
| `failed` | `ComposerOverlay.tsx:542-544, 606-614` | `· Failed` suffix in header; red `failure-banner` shown above editor |
| `scheduled` | `ComposerOverlay.tsx:480-490` | Renders extra "Convert to draft" button under SchedulingCard |
| `draft` | (no branch) | Default editable layout |
| `pending_approval`, `rejected`, `recurring`, `paused`, **`published`** | (no branch) | **Falls through to default editable layout — this is the bug** |

So when `editOriginalState === "published"`:
- Textarea is editable
- Schedule / Post now / Save as draft CTAs render
- PATCH is enabled — clicking Schedule re-flips state to `scheduled`

## 3. State → action mapping today

There is **no central mapping**. State checks are scattered:

- `ComposerOverlay.tsx:448` — `isPublishing`
- `ComposerOverlay.tsx:480` — `editOriginalState === "scheduled"`
- `ComposerOverlay.tsx:542, 606` — `failed` UI
- `app/api/platform/social/drafts/[id]/route.ts:105-110` — `MODE_TO_STATE`
  silently overwrites state via PATCH **without consulting current state**.
  A PATCH with `mode: "schedule"` against a `published` row flips it
  back to `scheduled` — published-post mutation is unguarded.
- `app/api/platform/social/drafts/[id]/route.ts:286-288` — DELETE
  already guards `published`/`publishing` (returns 409). PATCH does not.
- `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts:39-43`
  — only allows `scheduled` → `draft` (correct).

No file owns the "what can a post in state X actually do" question.
That gap is the bug.

## 4. Failures the current model produces

Reproduced or trivially derivable from the code:

| # | Surface | State | Current bug |
|---|---|---|---|
| F1 | Composer header | `published` | Renders "Edit post" + editable layout instead of read-only "Post info" |
| F2 | Composer body | `published` | Textarea editable; user can rewrite content that's already live on LinkedIn |
| F3 | Scheduling row | `published` | "Schedule post" CTA visible; clicking it issues PATCH that silently flips `published` → `scheduled` |
| F4 | Save as draft | `published` | Renders; clicking PATCHes state back to `draft` |
| F5 | PATCH endpoint | `published`/`publishing` | No server-side state guard — UI-bypass via curl mutates terminal-state rows |
| F6 | Composer body | `pending_approval` | Editable; editor can edit a post that's queued for approver |
| F7 | Composer body | `recurring`/`paused` | Editable like a draft; no recurrence-aware UI |
| F8 | "Convert to draft" | `published` | Brief exists for `scheduled`; missing for `failed` (where a back-to-draft retry makes sense) |
| F9 | Failure banner + retry | `failed` | Failure banner shows but there is no "Retry publish" affordance — user has to re-schedule |
| F10 | View on platform | `published` | No "View on LinkedIn" / open-post affordance even when `published_url` is populated |
| F11 | Repost as new | `published` | No way to clone a published post into a fresh draft |
| F12 | Delete affordance | `publishing` | DELETE returns 409 from the API (good) but the composer does not surface this; user can still click |
| F13 | Analytics | `published` | No path from composer to the analytics modal; modal exists elsewhere |

(F1–F5 are the Steven-reported set. F6–F13 are derived from the same
"no central matrix" root cause and are the basis for the backlog doc
in Part 5.)

## 5. Recommended state-action matrix

`PostState` = the DB enum, verbatim. `PostAction` is the set of UX
verbs we want to govern. Read-only by default for terminal states
(`published`, `publishing`).

| State | Allowed actions |
|---|---|
| `draft` | `edit`, `schedule`, `save_draft`, `delete` |
| `pending_approval` | `view`, `approve`, `reject`, `delete` |
| `rejected` | `edit`, `save_draft`, `delete` |
| `scheduled` | `edit`, `reschedule`, `convert_to_draft`, `delete` |
| `recurring` | `view`, `convert_to_draft`, `delete` |
| `paused` | `view`, `convert_to_draft`, `delete` |
| `publishing` | `view` (read-only; transient) |
| `published` | `view`, `view_on_platform`, `view_analytics`, `repost_as_new`, `delete_from_records` |
| `failed` | `edit`, `retry_publish`, `save_draft`, `delete` |

Explicit FORBIDDEN — assert in tests:

- `published` → never `edit`, never `schedule`, never `save_draft`,
  never `reschedule`, never `convert_to_draft`. **Never call any
  bundle.social unpublish API on delete.** `delete_from_records`
  only removes Opollo's row.
- `publishing` → never `edit`, never `schedule`, never `delete`
  (the publish job still owns the row); allow `view` only.
- `pending_approval` → only the approver can `approve`/`reject`;
  editors must `view` (they can recall via the existing
  approval-cancel flow, which is a separate transition, not an `edit`).

This is the matrix that Part 2 will encode in
`lib/social/post-state-actions.ts`.

## 6. Server-side enforcement gap

The composer fix is necessary but not sufficient. The PATCH endpoint
at `app/api/platform/social/drafts/[id]/route.ts:191` writes
`state = MODE_TO_STATE[mode]` with no current-state check. Any caller
(direct API, curl, future client) can mutate a `published` row.

The fix is a server-side guard at `route.ts` that returns 422 when
the existing row's `state` is `published` or `publishing`, before
the UPDATE fires. DELETE already does this at `route.ts:286-288` —
the working analog. PATCH must copy that shape.

## 7. Working analogs

For the read-only composer view:
- `components/SocialPostDetailClient.tsx` has a read-only post-info
  page used by the legacy posts list — reference pattern for
  metadata layout and "View on platform" link.
- `app/api/platform/social/drafts/[id]/analytics/route.ts` already
  joins to `social_post_analytics_snapshots` — analytics surface
  can be linked from the read-only view.

For the server guard:
- `app/api/platform/social/drafts/[id]/route.ts:286-288` (DELETE) —
  the exact shape the PATCH guard must mirror.
- `lib/platform/social/posts/transitions.ts` — `social_post_master`
  flow returns `INVALID_STATE` on predicate-guarded UPDATEs. Same
  conceptual pattern, different table.
