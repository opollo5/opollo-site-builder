# M3 — pre-start notes

Working doc for decisions / TODOs that must land in M3 but don't have a
proper brief yet. Folded into the M3 brief when Steven writes it.

## Inherited from M2a

**Tighten `NOT NULL` on `created_by` / `last_edited_by`.**

Confirmed in the M2 plan thread: the nullable FKs on
`design_systems.created_by` and `pages.last_edited_by` were introduced by
M1a because auth wasn't live yet. M2a wires auth up and M2d's admin UI
routes start populating those columns on every write. Once M2 is live
everywhere, every new row has a valid `created_by` / `last_edited_by`;
only the pre-M2 rows are NULL.

M3 must include a migration that:

1. Backfills the NULL rows — pick a strategy:
   - Leave them NULL and tighten the constraint to allow NULL for
     historical rows only (e.g. via a partial CHECK that permits NULL
     on rows created before a cutoff). Ugly.
   - Backfill to a sentinel `opollo_users` row representing "pre-auth
     migration". Then `ALTER COLUMN ... SET NOT NULL`. Cleaner — the
     sentinel can be a service user with role='viewer' that never logs
     in.
2. Tightens `design_systems.created_by` and `pages.last_edited_by` to
   `NOT NULL`.
3. Updates the Zod schemas in `lib/design-systems.ts` / `lib/pages.ts`
   (M3 adds pages CRUD) so the field is required at input time.

My preference: sentinel opollo_users row seeded at the start of M3's
migration, then `SET NOT NULL`. Record the decision in the M3 brief
before writing SQL.

## Other M3 carry-overs

- **Batch generator itself**: the core M3 deliverable. Consume the
  structured DS registry from M1d, fetch component HTML on demand,
  validate output via `lib/class-registry.ts` (M1f).
- **Caching**: `TODO(M3)` comment in `lib/system-prompt.ts` pins a
  site-keyed LRU with 5-min TTL around `loadActiveRegistry()`. Expected
  to matter at ~40 consecutive reads per site during batch runs.
- **`sites.design_system_version` (text)**: becomes dead data after
  M1d. M1 deferred dropping it; M3 or a cleanup milestone drops the
  column.
