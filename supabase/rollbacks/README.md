# Rollback scripts

Hand-run SQL files that reverse a corresponding forward migration from
`supabase/migrations/`. These are **not** applied by `supabase start` or
any other automated tool — you run them deliberately, with `psql`,
against a database you've chosen to roll back.

## Why not in `supabase/migrations/`?

The Supabase CLI treats every `*.sql` under `supabase/migrations/` as a
forward migration and registers it in `supabase_migrations.schema_migrations`
keyed by the `NNNN` filename prefix. A `.down.sql` that shares the prefix
of a forward migration:

1. Gets picked up first (lexical sort: `0002_m1a_design_system_schema.down.sql`
   comes before `0002_m1a_design_system_schema.sql`).
2. Registers itself in `schema_migrations` under version `0002`.
3. Blocks the real forward `0002_*.sql` from applying — it tries to insert
   another `0002` row and hits a unique-key violation on the primary key.

That's exactly the failure mode CI was hitting. Fixed by moving the
rollbacks out of the migrations directory.

## How to run a rollback

1. **Make sure nothing else is writing to the database.** Rollbacks
   execute DROP TABLE / DROP FUNCTION; in-flight writes against the
   dropped objects will fail.
2. Export a libpq-compatible `DATABASE_URL`. For local dev:
   ```
   export DB_URL="$(supabase status --output json | jq -r .DB_URL)"
   ```
   Or for prod Supabase, grab the connection string from the project
   settings. **Never run a rollback against prod without a backup.**
3. Run the rollback file:
   ```
   psql "$DB_URL" -f supabase/rollbacks/NNNN_name.down.sql
   ```
4. Verify the expected state per the rollback's header comment
   (usually a small SELECT that should return zero rows).
5. **Manually remove the corresponding row from `schema_migrations`** so
   the forward migration can be re-applied cleanly by `supabase start`
   or `supabase db push`:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations
    WHERE version = 'NNNN';
   ```
   Skip this step and the next `supabase start` will see `NNNN` already
   "applied" and won't re-run the forward migration, leaving the DB in a
   rolled-back state permanently.

## Ordering when rolling back multiple migrations

Always run rollbacks in **reverse** of the forward order. For the current
M1 stack:

1. `0003_m1b_rpcs.down.sql` — drops `activate_design_system()` first
   because the 0002 tables it references are about to go.
2. `0002_m1a_design_system_schema.down.sql` — drops the 5 M1 tables.

Then delete both rows from `schema_migrations`.

## When to write a new rollback

Every new forward migration under `supabase/migrations/` ships with a
matching `NNNN_name.down.sql` in this directory (same numeric prefix, same
descriptive stem). The `NNNN` prefix mirror makes grep-to-find trivial;
the physical separation keeps the CLI from tripping over them.
