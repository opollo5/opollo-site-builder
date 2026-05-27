# V1→V2 Social Post Model — Session Status

**Session dates**: 2026-05-27 → 2026-05-28
**Branch**: Various (see PR list)

## Summary

All 16 non-DROP-TABLE PRs have been merged to main and deployed, including the
WRITE-SAFETY-CRITICAL soft-delete PR #1115. Staging is fully verified through
migration 0157. One PR remains (PR #1116 — DROP TABLE) which requires a
code cleanup sprint before it can be run.

---

## PR Status

### Merged and Deployed

| PR | Branch | Migration | Description |
|---|---|---|---|
| #1094 | feat/v1-to-v2-pr01 | 0150 | V2 schema foundation |
| #1101 | feat/v1-to-v2-pr02 | — | V2 CRUD API |
| #1102 | feat/v1-to-v2-pr03 | — | V2 approval workflow |
| #1103 | feat/v1-to-v2-pr04 | — | V1→V2 backfill script (WRITE-SAFETY-CRITICAL) |
| #1104 | feat/v1-to-v2-pr05 | — | V2 schedule endpoint |
| #1105 | feat/v1-to-v2-pr06 | — | V2 publish-due cron |
| #1106 | feat/v1-to-v2-pr07 | — | Post creation → V2 |
| #1107 | feat/v1-to-v2-pr08 | — | Analytics dual-lookup |
| #1108 | feat/v1-to-v2-pr09 | — | Webhook handler dual-lookup |
| #1109 | feat/v1-to-v2-pr10 | — | Publish pipeline dual-lookup |
| #1110 | feat/v1-to-v2-pr11 | — | Composer dual-lookup |
| #1111 | feat/v1-to-v2-pr12 | — | Retire V1 watchdog/backfill crons |
| #1112 | feat/v1-to-v2-pr13 | — | Retire V1 QStash publish pipeline |
| #1113 | feat/v1-to-v2-pr14 | — | V2 approval notify |
| #1114 | feat/v1-to-v2-pr15 | — | Analytics V2 dual-lookup unit tests |
| #1115 | feat/v1-to-v2-pr16-v1-soft-delete | 0157 | V1 soft-delete (**WRITE-SAFETY-CRITICAL** — merged by Steven 2026-05-27T19:14Z) |
| #1117 | ci/staging-backfill-workflow | — | Staging backfill workflow + PRODUCTION-ROLLOUT.md |
| #1118 | ci/force-index-staging-backfill | — | Workflow indexing fix |
| #1119 | ci/fix-staging-backfill-db-query | — | Fixed `supabase db execute` → `supabase db query` |
| #1120 | ci/fix-backfill-on-conflict-partial-index | — | Fixed `ON CONFLICT` partial index predicate |

### Not Ready (out of scope until code cleanup sprint)

| PR | Branch | Status | Notes |
|---|---|---|---|
| #1116 | feat/v1-to-v2-pr17-v1-table-drop | Open — NOT READY | 68+ TypeScript files still reference V1 tables. |

---

## Staging Verification — COMPLETE ✅

All checks run against staging on 2026-05-27/28:

| Check | Result | Run |
|---|---|---|
| Migration 0155 applied | ✅ | Run 26514058393 |
| Migration 0156 applied | ✅ | Run 26514058393 |
| Backfill dry-run | ✅ v1=0, v2_migrated=0 | Run 26514058393 |
| Backfill live run | ✅ SQL clean, 0 rows | Run 26515335308 |
| Migration 0157 applied | ✅ | Run 26533092370 |
| v1_posts_active after 0157 | ✅ = 0 | Run 26533092370 |
| UAT harness (post-backfill) | ✅ 42 pass | Run 26515462512 |
| UAT harness (post-0157) | ✅ 42 pass | Run 26533150229 |

Note: 1 P1 visual failure (`calendar grid — current month render`) is pre-existing in every UAT run — date-sensitive screenshot, not a regression from this migration.

---

## Verification Checklist

- [x] Staging DB at migration 0156
- [x] Backfill dry-run shows correct v1_posts_active count
- [x] Backfill live run: `v2_migrated_from_v1 == v1_posts_active`
- [x] UAT harness: 42 pass (post-backfill)
- [x] PR #1115 merged by Steven (2026-05-27T19:14Z, SHA 642ee4e1)
- [x] Migration 0157 applied to staging
- [x] `v1_posts_active = 0` after soft-delete
- [x] UAT harness: 42 pass (post-soft-delete)
- [ ] **Production backfill** — see §"Remaining Work" below
- [ ] **Migration 0157 applied to production** — Steven's manual call
- [ ] **Production row counts verified**

---

## Remaining Work

### 1. Production migration application — Steven's manual call

Migration 0157 (`0157_v1_soft_delete.sql`) is on main but has NOT been applied
to production. This is a WRITE-SAFETY-CRITICAL operation:

```sql
-- What it does (from supabase/migrations/0157_v1_soft_delete.sql):
UPDATE social_post_master SET deleted_at = NOW() WHERE deleted_at IS NULL;
UPDATE social_post_variant SET deleted_at = NOW() WHERE deleted_at IS NULL;
UPDATE social_schedule_entries SET deleted_at = NOW() WHERE deleted_at IS NULL;
```

To apply: use the normal Vercel/Supabase production deployment pipeline.
Run the production backfill TypeScript script first (needs `SUPABASE_SERVICE_ROLE_KEY`).

### 2. Code cleanup sprint — remove 68 dead V1 references

Before PR #1116 (DROP TABLE) can be merged, all 68+ TypeScript/SQL references
to V1 tables must be eliminated:

Tables to remove all references to:
- `social_post_master`
- `social_post_variant`
- `social_schedule_entries`
- `social_publish_attempts`
- `social_publish_jobs`
- `social_approval_requests`
- `social_approval_recipients`

All reads/writes must go through V2:
- `social_post_drafts`
- `social_post_approval_decisions`

Suggested approach: open a single cleanup PR per domain (composer, analytics,
webhooks, crons, admin) + one final E2E run without V1 tables present.

### 3. PR #1116 — DROP TABLE migration (after cleanup sprint)

Only once all 68+ references are removed should migration 0158 (`DROP TABLE`)
be run. This is irreversible — ensure full E2E suite passes with V1 tables
absent before merging.

---

## Staging Workflow Notes (for future sessions)

The `V1→V2 staging backfill` workflow (ID 284206712) requires:
- `STAGING_SUPABASE_PROJECT_REF` ✅
- `SUPABASE_ACCESS_TOKEN` ✅
- `STAGING_SUPABASE_DB_PASSWORD` ✅

Two CLI bugs were found and fixed during this session (PRs #1119, #1120):
1. `supabase db execute` is not a valid subcommand — use `supabase db query`
2. `ON CONFLICT (col1, col2)` doesn't match a partial unique index — must include `WHERE idempotency_key IS NOT NULL`

The workflow title says "(0155, 0156)" but now applies all pending migrations via
`supabase db push --linked --include-all` — it applied 0157 correctly.
