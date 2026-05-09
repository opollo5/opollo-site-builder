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
