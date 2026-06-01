# UX debt — live items

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Backlog — UX debt".
>
> **Shipped items deleted.** Per the restructure directive: ship-state
> lives in git log, not in this backlog. The previous "High — remove
> scope_prefix" (M2d) and "Medium — jargon in design-system authoring
> forms" (M6-4) entries have been removed; consult git log for those.

Operator-facing jargon that leaks DB column names or internal
implementation detail. Pick up on a cleanup slice that naturally lives
in M6 (Per-Page Iteration UI, where admin UX polish fits), or earlier
if a sibling slice happens to be in the same file.

## Low — admin-surface labels that expose IDs

Scan done 2026-04, none found on the primary surfaces:

- `app/admin/batches` / `[id]` — shows "WP id" as a column, which is
  operator-meaningful (they can click through to WP admin); keep.
- `/admin/users` — email + role + status, clean.
- `/admin/sites` — name + URL + status, clean.

No `design_system_id`, `version_lock`, `wp_page_id`, `created_by_uuid`
leaked into labels. Revisit if future surfaces add them.

## Image gen — auto-attach caption refinement

**Item:** `findOrCreateScheduledDraft` create-only rule blocks captions on pre-existing empty shells.

**Current behaviour:** `content` is written only on new draft creation, never on update — correct for operator-edited drafts. But if an empty shell (`content = ""`) already exists for a date (e.g. from a pre-fix batch approval), a subsequent approval for the same date finds that draft, appends the image, and leaves `content = ""` — the caption is silently dropped even though the operator hasn't written anything.

**Proposed refinement:** In the find path, if `existing_draft.content === ""` (blank, not just whitespace), write `post_text` to it. This fills empty shells while never overwriting real operator text (any non-empty content is treated as intentional and left alone).

**Risk:** Requires reading `content` from the found draft (one extra field in the SELECT), then a conditional UPDATE. The update must be fail-soft — same contract as the rest of auto-attach. No schema change needed.

**Scope:** `findOrCreateScheduledDraft` in `lib/image/auto-attach.ts` — add `content` to the find SELECT, add a conditional PATCH if found draft has blank content. New test: find-path with blank existing content → content updated; find-path with non-blank content → content NOT updated.
