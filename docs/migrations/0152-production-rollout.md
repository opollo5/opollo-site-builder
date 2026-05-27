# Migration 0152 — production rollout

Companion to PR #1086 (`fix(social/publish-due): atomic claim via FOR
UPDATE SKIP LOCKED`). The migration adds the schema scaffolding the new
publish-due cron uses to atomically claim due drafts; the route refactor
in the same PR uses these columns.

## What migration 0152 does

`supabase/migrations/0152_publish_due_atomic_claim.sql` makes three
changes to `social_post_drafts`:

| Change | Type | Effect |
|---|---|---|
| `ADD COLUMN publish_claimed_at TIMESTAMPTZ` | nullable, no DEFAULT | Stamped when the publish-due cron transitions a draft from `scheduled` → `publishing`. Powers a future stale-claim reaper (see GitHub issue linked in PR #1086). |
| `ADD COLUMN publish_worker_id TEXT` | nullable, no DEFAULT | Diagnostic — identifies the Vercel deployment + PID that claimed the row. Mirrors `brief_runs.worker_id`. |
| `CREATE INDEX idx_social_post_drafts_scheduled_for_claim` | partial, `WHERE state='scheduled' AND archived_at IS NULL` | Supports the FOR UPDATE SKIP LOCKED candidate scan in `lib/social/publishing/claim-due-drafts.ts`. |

All statements are guarded by `IF NOT EXISTS`. The migration runs inside
a single `BEGIN; ... COMMIT;` block.

## Risk: SAFE

| Concern | Assessment |
|---|---|
| Lock duration | Two nullable `ADD COLUMN` operations + one `CREATE INDEX` on a non-trivial table. PostgreSQL takes a brief `AccessExclusiveLock` to add the columns (instant since no DEFAULT means no rewrite), and the partial `CREATE INDEX` (no `CONCURRENTLY` here) takes a `ShareLock` for the duration of the build. On staging the entire migration completed in <1s. Production `social_post_drafts` is similar in size — expect single-digit seconds. |
| Data rewrite | None. `ADD COLUMN ... TIMESTAMPTZ` with no DEFAULT does not touch existing rows; PostgreSQL stamps the column as nullable. |
| Existing reads | All reads of `social_post_drafts` either explicitly list columns (`select("id, state, ...")`) or use `select("*")`. The new nullable columns are forward-compatible with both. |
| Existing writes | The publish-due route is the only writer that targets the new columns. All other writes (composer save, schedule action, etc.) leave them unset. |
| Concurrent cron tick during migration | The migration takes a short ACCESS EXCLUSIVE lock during ADD COLUMN. A cron tick mid-migration would block briefly, then resume against the new schema. No data loss; at worst a single tick's batch deferred by a few seconds. |

## Rollback

If 0152 needs to be reverted in production:

```sql
BEGIN;
DROP INDEX IF EXISTS idx_social_post_drafts_scheduled_for_claim;
ALTER TABLE social_post_drafts
  DROP COLUMN IF EXISTS publish_worker_id,
  DROP COLUMN IF EXISTS publish_claimed_at;
COMMIT;
```

The columns are nullable with no DEFAULT, so dropping them is purely
schema metadata change — no data loss, no row rewrites. The index drop
is metadata-only as well. Total rollback time: <1s.

Note: after rollback, the publish-due cron deployed by PR #1086 will
fail because its CTE references the dropped columns. Revert the
deployed bundle in tandem (Vercel deployment rollback to the
pre-PR-#1086 commit).

## Recommended deploy window

**No specific window required.** Migration is non-blocking, takes
seconds, and is forward-compatible with existing reads/writes. Apply
during any normal deploy window.

## Pre-flight (staging)

1. Verify columns exist on staging:

   ```bash
   curl -s -H "apikey: $STAGING_SUPABASE_SERVICE_KEY" \
        -H "Authorization: Bearer $STAGING_SUPABASE_SERVICE_KEY" \
     "$STAGING_SUPABASE_URL/rest/v1/social_post_drafts?select=id,publish_claimed_at,publish_worker_id&limit=1"
   ```
   Expect: JSON row including `"publish_claimed_at":null` and `"publish_worker_id":null`. Done as part of PR #1086 rollout (see PR #1086 acceptance log).

2. Verify index exists on staging (Supabase SQL editor):

   ```sql
   SELECT indexname FROM pg_indexes
   WHERE indexname = 'idx_social_post_drafts_scheduled_for_claim';
   ```
   Expect one row.

3. Confirm the publish-due cron has run at least once on staging after
   migration apply without errors (check Vercel cron logs or the
   `service_health` heartbeat row for `publish-due`).

## Post-flight (production)

After production migration apply:

1. **Verify columns exist in production:**

   ```bash
   curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
     "$SUPABASE_URL/rest/v1/social_post_drafts?select=id,publish_claimed_at,publish_worker_id&limit=1"
   ```
   Expect JSON row including both new columns (value `null`).

2. **Verify index exists in production** — same `pg_indexes` query as
   the staging pre-flight.

3. **Verify the publish-due cron completes on the next tick.** The
   cron runs every minute. Within 2 minutes of the production deploy:

   ```sql
   SELECT service_name, status, last_ok_at, last_error_at, last_error_message
   FROM service_health
   WHERE service_name = 'publish-due'
   ORDER BY last_ok_at DESC NULLS LAST
   LIMIT 1;
   ```

   Expect: `status = 'ok'` and `last_ok_at` within the last 2 minutes.
   If `status = 'error'`, read `last_error_message` and the Vercel
   function logs.

4. **Confirm no rows stuck in `publishing` longer than expected.**
   Bundle.social timeout is ~30s; rows should transition to
   `published` or back to `scheduled` within a minute:

   ```sql
   SELECT COUNT(*) FROM social_post_drafts
   WHERE state = 'publishing'
     AND publish_claimed_at < now() - INTERVAL '5 minutes';
   ```

   Expect `0`. If non-zero, the stale-claim reaper (separate
   follow-up issue from PR #1086) is needed urgently.

## Related

- PR #1086 — the code change this migration unblocks
- `lib/social/publishing/claim-due-drafts.ts` — the function that uses the new columns
- `app/api/internal/cron/publish-due/route.ts` — the cron route refactored to use the claim function
- `lib/__tests__/publish-due-concurrency.test.ts` — Layer 3 test proving atomic claim
- `scripts/audit.ts` check #16 — CI gate preventing regression of the lock primitive
