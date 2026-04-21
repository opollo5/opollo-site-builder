# Pattern — New migration

## When to use it

Any schema change: new table, new column, new constraint, new index, new RLS policy, new RPC, new trigger.

Don't use for: data migrations (row rewrites in bulk) — those go under `supabase/data-migrations/` and have a different shape. See `docs/DATA_CONVENTIONS.md`.

## Required files

| File | Role |
| --- | --- |
| `supabase/migrations/0NNN_<slug>.sql` | Forward migration. The N-prefix is the version the Supabase CLI registers. |
| `supabase/rollbacks/0NNN_<slug>.down.sql` | Hand-runnable reverse script. Lives outside `supabase/migrations/` so the CLI doesn't try to apply it. |
| `lib/__tests__/<slug>.test.ts` | Applied-migration assertions: constraints reject invalid inserts, cascades fire as expected, RLS policies honour the role matrix. |
| `supabase/rollbacks/README.md` | Add a line if the new migration has subtlety worth warning future operators about. |

If the migration extends a type, schema, or enum that TypeScript reflects, regenerate types after apply.

## Scaffolding

### Forward migration

Model on `supabase/migrations/0007_m3_1_batch_schema.sql`. Structure:

```sql
-- 0NNN — <short title>.
-- Reference: <M-slice or infra topic>. Parent plan in PR description of <issue/PR>.
--
-- Design decisions encoded here:
--
-- 1. <invariant>: <why it's expressed at the schema layer and not at the app>.
-- 2. <invariant>: ...
--
-- Write-safety hotspots addressed:
--   - <concurrent writers / idempotency / race window / unique claim>
--   - ...

-- ----------------------------------------------------------------------------
-- <section header> — <one-line intent>
-- ----------------------------------------------------------------------------

CREATE TABLE <name> (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  <cols>       ...,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL,
  created_by   uuid REFERENCES auth.users(id) NULL,
  updated_by   uuid REFERENCES auth.users(id) NULL
);

CREATE UNIQUE INDEX <name>_<slug>_unique ON <name>(<cols>);

ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY service_role_all ON <name>
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated-role policies: defence-in-depth. Routes go through
-- service-role after the admin gate; these are here in case a view ever
-- gets exposed via PostgREST.
CREATE POLICY authed_read_own ON <name>
  FOR SELECT TO authenticated
  USING ( <predicate referencing public.auth_role()> );
```

Key shape rules:

- **New tables get `deleted_at` + audit columns** per `docs/DATA_CONVENTIONS.md`. Existing tables fold in on the next natural migration.
- **RLS on by default.** Every new table ships `ENABLE ROW LEVEL SECURITY` + `service_role_all` + at least one `authenticated`-role policy.
- **`CHECK (status IN (...))`** over Postgres `ENUM` types. ENUMs are hard to alter; CHECK constraints rewrite in one ALTER.
- **Unique constraints** for every invariant the app cares about. A UNIQUE at the schema layer survives bugs in the app layer; relying on app-level checks means every new code path is one missed guard away from a duplicate.
- **`ON DELETE CASCADE` / `ON DELETE SET NULL`** declared explicitly. Silent defaults to `NO ACTION` bite.

### Rollback

Model on `supabase/rollbacks/0007_m3_1_batch_schema.down.sql` (if it exists; otherwise model on an earlier `*.down.sql`). Mirror the forward migration in reverse order:

```sql
-- Rollback for 0NNN_<slug>.sql
-- Drops the objects that migration created; does NOT restore row data.
-- Intended for local dev / CI reset, not production recovery.

DROP POLICY IF EXISTS authed_read_own ON <name>;
DROP POLICY IF EXISTS service_role_all ON <name>;
ALTER TABLE IF EXISTS <name> DISABLE ROW LEVEL SECURITY;
DROP INDEX IF EXISTS <name>_<slug>_unique;
DROP TABLE IF EXISTS <name>;
```

Use `IF EXISTS` everywhere so rerunning the rollback is idempotent.

**Rollbacks live in `supabase/rollbacks/`, NOT `supabase/migrations/`.** The Supabase CLI lexically sorts every `*.sql` under `migrations/` and registers each in `schema_migrations`. A `0NNN_*.down.sql` under `migrations/` would grab the `0NNN` version first and block the forward from applying. See `supabase/rollbacks/README.md` for the full backstory.

### Tests

Model on `lib/__tests__/m3-schema.test.ts`. Cover at minimum:

1. **Constraint-reject tests.** Try to insert a row that violates each new CHECK / UNIQUE / FK. Assert the right error code (23505, 23503, 23514).
2. **Happy-path insert** proving the column types + defaults work.
3. **Cascade / set-null behaviour.** Delete the parent, confirm the child goes / nulls as declared.
4. **RLS matrix.** For each role (service_role, admin, operator, viewer, authenticated-no-role), attempt SELECT / INSERT / UPDATE / DELETE; assert the documented allow / filter / deny per cell. Copy from `lib/__tests__/m2b-rls.test.ts`.
5. **Trigger behaviour** (if a trigger was added). Exercise the trigger's happy path and every guard.

Tests hit the live local Supabase via `supabase start`; `_setup.ts` truncates between tests. No mocks.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md).

Title: `feat(m<slice>): <schema change summary>` — e.g. `feat(m3-1): batch generator schema`.

Description sections per the sub-slice pattern. Call out explicitly:

- Every UNIQUE / CHECK / FK the migration adds.
- Whether the migration is safe to run on a table with existing rows (e.g. `ADD CONSTRAINT UNIQUE` fails if dupes exist — state the expected pre-check).
- Whether any RLS policy change could block a currently-working code path.

## Known pitfalls

- **`.down.sql` in `supabase/migrations/`** — the CLI picks it up first, registers it as the migration, blocks the forward. Always put rollbacks under `supabase/rollbacks/`. (Caught during M1 setup; documented in `supabase/rollbacks/README.md`.)
- **Missing UNIQUE on a high-churn table.** A concurrency invariant expressed only in app code is one missed guard away from a dupe row. PR #35 relied on `pages (site_id, slug) UNIQUE` to short-circuit dup-worker races; without it, two workers would double-publish.
- **Forgetting `ENABLE ROW LEVEL SECURITY`.** Table ships open. `authenticated` role can SELECT everything. RLS must be enabled *and* have at least one policy; enabling without policies denies everything (the safer failure mode).
- **`ADD CONSTRAINT UNIQUE` on a populated table.** Fails loud if existing dupes exist. Pre-check with `SELECT ..., count(*) FROM <table> GROUP BY <cols> HAVING count(*) > 1` and decide: migrate the dupes first, or fail the migration and triage.
- **Trigger that modifies the same table as the worker's UPDATE loop.** Deadlock risk. Triggers run inside the same transaction — a trigger UPDATEing a row the worker is about to UPDATE causes row-level-lock contention. Prefer app-level bumping of `updated_at`; reserve triggers for cases where the app can't be trusted (cross-service sync, etc.).
- **Not regenerating types.** Supabase-generated TS types go stale; the type checker won't catch column drift. Run the regen script (if wired; else update `lib/tool-schemas.ts` by hand).
- **Dropping an in-use column in a single migration.** In a zero-downtime deploy, the old app version reads the column while the new one doesn't. Stage it: (a) stop writing, (b) stop reading, (c) drop.
- **`CASCADE` sweeping a sequence the test role doesn't own.** `TRUNCATE auth.users CASCADE` fails on `refresh_tokens_id_seq` in local Supabase because the test role doesn't own the sequence. Use the admin API instead of SQL cascade for auth-related cleanup. Caught by `lib/__tests__/_setup.ts`.

## Pointers

- Shipped examples: `supabase/migrations/0005_m2b_rls_policies.sql`, `0007_m3_1_batch_schema.sql`, `0009_m3_7_retry_after.sql`.
- Related: [`new-api-route.md`](./new-api-route.md) (the code that uses the new schema), [`ship-sub-slice.md`](./ship-sub-slice.md).
- `docs/DATA_CONVENTIONS.md` — soft-delete / audit columns / version_lock contract.
- `supabase/rollbacks/README.md` — why rollbacks live outside `migrations/`.
