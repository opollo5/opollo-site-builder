# Data Conventions

Forward-facing spec for schema hygiene. The patterns below are the target for new tables and the cleanup direction for existing ones. Don't rewrite existing tables wholesale — fold these in on the next natural migration.

---

## Soft delete

**Rule:** deletion is a state transition, not a row drop. Every mutable table that carries business data should have:

```sql
deleted_at timestamptz NULL,
deleted_by uuid REFERENCES auth.users(id) NULL
```

Paired behaviour:

- Queries exclude `deleted_at IS NOT NULL` by default; a separate "include-archived" read path is opt-in per call.
- The row stays so foreign keys from historical `generation_events`, `pages`, etc. keep resolving.
- RLS policies treat `deleted_at IS NULL` as "visible to non-admins" and include soft-deleted rows for admins only.

**Existing exceptions:**

- `sites` currently uses `status='active' | 'removed'` instead of `deleted_at`. Keep both columns in sync when `sites` migrates: set `deleted_at = now()` when flipping to `removed`. The `status` column stays because the UX surfaces it.
- `generation_events` is append-only — no delete path.
- `auth.users` is owned by Supabase; not ours to soft-delete. Revocation goes through `auth.users.banned_until`.

---

## Audit columns

Every mutable table should carry:

```sql
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
created_by uuid REFERENCES auth.users(id) NULL,
updated_by uuid REFERENCES auth.users(id) NULL
```

- `created_at` / `updated_at` — already on most tables. Where missing, add them on the next migration.
- `created_by` / `updated_by` — for operator actions, populated by the API layer (`lib/http.ts`'s handlers pass the `user.id` from `getCurrentUser()` into the INSERT/UPDATE). Background workers (M3) leave `updated_by` NULL and let the `generation_events` log carry the provenance; worker writes are distinct from operator writes.
- `updated_at` is bumped by the app, not by a trigger. Triggers for this add a deadlock surface we've burned on before; explicit writes are simpler.

---

## Versioning (optimistic concurrency)

For tables that allow concurrent operator edits (`design_systems`, `design_components`, `design_templates`):

```sql
version_lock integer NOT NULL DEFAULT 1
```

- Every UPDATE sets `version_lock = version_lock + 1`.
- The caller passes `expected_version_lock`; the UPDATE predicates on it. Zero affected rows → `VERSION_CONFLICT` error.
- Not a replacement for row-level locks — use it on top of `FOR UPDATE` where a transaction holds multiple rows.

---

## Data migrations

Schema migrations live in `supabase/migrations/`. Data migrations — operations that rewrite existing rows in a controlled, reversible way — live in `supabase/data-migrations/` (directory to be added when the first data migration surfaces).

Contract for a data migration:

1. Idempotent. Running it twice leaves the DB in the same state.
2. Batched. No single statement updates more than 10 000 rows; use a loop with a `WHERE deleted_at IS NULL AND last_touched < :cutoff` filter.
3. Committed as a named SQL file plus a companion `runbook.md` entry explaining when to run it and the rollback path.
4. Never `UPDATE ... SET` without `WHERE` — even in one-row migrations.

Examples that will live here: re-encrypting `sites.wp_app_password` under a rotated `OPOLLO_MASTER_KEY`, bulk-archiving stale `generation_events`, backfilling `created_by` on rows that predate user-tracking.

---

## Naming

- Tables: singular-snake-case, owned-by-us. (`sites`, `opollo_users`, `generation_job_pages`.) Grandfathered plurals like `pages` stay plural.
- Status / enum columns: `snake_case` text with a `CHECK (status IN (...))` constraint, not a Postgres ENUM type. ENUMs are hard to alter; CHECK constraints rewrite in one ALTER.
- Timestamps: `*_at`. Booleans: `is_*`. Foreign keys: `<table>_id`.
- Do not encode type in the column name (`is_active_bool`, `name_text`).

---

## RLS

Every new table ships with `ENABLE ROW LEVEL SECURITY`. Service-role policies are `FOR ALL USING (true)`; authenticated-role policies read from `public.auth_role()` to key off `opollo_users.role`. See `supabase/migrations/0005_m2b_rls.sql` for the canonical shape.
