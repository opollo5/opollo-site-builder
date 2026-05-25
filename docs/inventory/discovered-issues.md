# Discovered Issues

**Generated:** 2026-05-25 — issues discovered during Phase 1 inventory codebase analysis.
**Process:** These issues were found incidentally while reading source files to populate the inventory. They are documented here for triage, not necessarily as bugs to fix immediately.

---

## Issue 1 — Published posts open in an editable composer (confirmed bug)

**Discovered during:** Components catalog analysis of `ComposerOverlay.tsx`
**Severity:** Medium — user experience / data integrity

**Description:**
`ComposerOverlay` accepts `editOriginalState?: DraftState` to signal when the composer is opening a non-draft post. The `isReadOnlyState()` helper in `lib/social/post-state-actions.ts` is intended to prevent edits on terminal states (`published`, `publishing`, `failed`). However, the `PATCH /api/platform/social/drafts/[id]` route separately guards terminal states via `isTerminalForMutation()`.

The question is whether the UI consistently enforces `readOnly=true` on the `ComposerEditor` when `editOriginalState='published'`. The `ComposerOverlay` has both `isReadOnlyState` logic and a `readOnly` prop on `ComposerEditor`, but any code path that opens the overlay for a `published` post without setting `editOriginalState` would render the form as fully editable — even though the PATCH will return `INVALID_STATE (409)` at submission time.

**Files involved:**
- `components/social/composer/ComposerOverlay.tsx` — `editOriginalState` prop, `isReadOnlyState` call
- `components/social/composer/ComposerEditor.tsx` — `readOnly` prop
- `lib/social/post-state-actions.ts` — `isReadOnlyState()`, `isTerminalForMutation()`
- `app/api/platform/social/drafts/[id]/route.ts` (lines 143–158) — server-side INVALID_STATE guard

**Evidence:** The inventory spec brief for this branch (`fix/composer-central-image-library`) references edit-mode composer fixes, and `e2e/composer-edit-mode-verification.spec.ts` (untracked) exists as a verification spec.

**Action:** Steven to verify whether clicking a `published` post chip on the calendar or posts list opens the composer in read-only mode.

---

## Issue 2 — Two parallel state machines: SocialPostState vs DraftState

**Discovered during:** Forms and validation research; types cross-reference
**Severity:** Low — technical debt / documentation gap

**Description:**
The codebase has two distinct state enumerations for what is conceptually the same entity (a social post):

**V1 legacy (`lib/platform/social/posts/types.ts`):**
```typescript
export type SocialPostState =
  | "draft"
  | "pending_client_approval"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed";
```

**V2 composer (`lib/social/types.ts`):**
```typescript
export type DraftState =
  | "draft"
  | "pending_approval"    // ← different from "pending_client_approval"
  | "rejected"
  | "scheduled"
  | "recurring"           // ← not in V1
  | "paused"              // ← not in V1
  | "publishing"
  | "published"
  | "failed";
```

**Key differences:**
- V1 uses `pending_client_approval`, `approved`, `changes_requested` — V2 does not
- V2 uses `pending_approval`, `recurring`, `paused` — V1 does not
- V2 uses `social_post_drafts` table; V1 uses `social_post_masters` table

This means the posts list page (`SocialPostsListClient`) uses `SocialPostState` with V1 filter tabs, while the composer (`ComposerOverlay`) uses `DraftState`. There is no unified type, and any code that tries to use one where the other is expected will have type errors or runtime mismatches.

**Files involved:**
- `lib/platform/social/posts/types.ts` — V1 state type
- `lib/social/types.ts` — V2 state type
- `components/SocialPostsListClient.tsx` — uses `SocialPostState`
- `components/social/composer/ComposerOverlay.tsx` — uses `DraftState`

**Action:** The V1 and V2 state machines are a documented parallel-running period. This is not a bug to fix now — it is an expected transitional state. Flagged here so Phase 3 UAT specs know to test each state using the correct type system.

---

## Issue 3 — `pending_identity` status added via ALTER TYPE (migration 0122), not in original enum

**Discovered during:** State machines inventory analysis
**Severity:** Low — legacy type-check risk

**Description:**
The `pending_identity` status on `social_connections` was added via `ALTER TYPE` in migration 0122, not as part of the original enum definition. Any TypeScript code written before migration 0122 that uses an exhaustive switch over connection status values may not handle `pending_identity`, causing a TypeScript `never` branch or a silent fall-through at runtime.

**Files to check:**
- `lib/platform/social/connections/` — any switch or if-chain over connection status
- `components/social/dashboard/` — connection status display logic
- `e2e/uat/connections.spec.ts` — the disconnect dialog fix (referenced in PR #1057/1060) may have addressed this

**Action:** Before writing UAT specs for connection status flows, verify that all switch/if chains over `social_connections.status` include `pending_identity` as an explicit case.

---

## Issue 4 — Composer edit-mode behaviour for published/failed states is an open question

**Discovered during:** ComposerOverlay prop analysis
**Severity:** Medium — UAT gap

**Description:**
`ComposerOverlay` has an `editOriginalState` prop of type `DraftState`. The comment in the file says:

> "Original state of the draft being edited (for header copy + convert-to-draft action)."

For `failed` state, `failureReason` prop is provided and shown as an error banner. For `published` state, the composer should be read-only.

However, the branch currently under work (`fix/composer-central-image-library`) exists specifically to fix composer behaviour around image library and edit mode. The `e2e/composer-edit-mode-verification.spec.ts` file (untracked, added on this branch) is a verification spec for this exact scenario — but it has not been committed to the branch yet, suggesting the verification is incomplete.

**Files involved:**
- `components/social/composer/ComposerOverlay.tsx` — `editOriginalState`, `failureReason` props
- `lib/social/post-state-actions.ts` — `isReadOnlyState()`, `canPerform()`
- `e2e/composer-edit-mode-verification.spec.ts` — untracked verification spec on current branch

**Action:** When Phase 2 fills in EXPECTED BEHAVIOUR for `ComposerOverlay`, explicitly answer:
- What can a user do in the composer when `editOriginalState = 'published'`?
- What can a user do in the composer when `editOriginalState = 'failed'`?
- Can a user convert a `failed` post back to `draft` via the composer?

---

## Issue 5 — ApproveSchema vs UI decisions mismatch (changes_requested)

**Discovered during:** Forms and validation analysis
**Severity:** Low — potential API contract gap

**Description:**
`ApprovalDecisionForm.tsx` defines three decisions client-side:
```typescript
type Decision = "approved" | "rejected" | "changes_requested";
```

But `ApproveSchema` in `lib/social/schemas/approve.ts` only accepts:
```typescript
decision: z.enum(["approved", "rejected"])
```

The `changes_requested` option exists in the UI but is not in the Zod schema. This means either:
1. `changes_requested` maps to `rejected` in the API call, or
2. There is a separate code path for `changes_requested` that bypasses `ApproveSchema`, or
3. The UI and the schema are out of sync (the `changes_requested` button calls the API with a value the schema rejects)

**Files involved:**
- `components/ApprovalDecisionForm.tsx` — UI Decision type
- `lib/social/schemas/approve.ts` — ApproveSchema
- `app/api/approve/[token]/decision/route.ts` — route handler (not read during inventory)

**Action:** Read `app/api/approve/[token]/decision/route.ts` to determine which path `changes_requested` takes at the API layer.
