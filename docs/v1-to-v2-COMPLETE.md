# V1→V2 Social Post Model — Migration Complete

**Completed**: 2026-05-28  
**Branch**: Multiple (see PR table below)

## Final Production State

All V1 social post data is soft-deleted in production. The V2 pipeline
(`social_post_drafts` + `social_post_approval_decisions`) is the sole active
data path. V1 tables still exist in schema — DROP TABLE (PR #1116) is deferred
pending the V1 code cleanup sprint.

---

## Production Migration Timeline

| Time (UTC) | Event |
|---|---|
| 2026-05-27T19:14Z | PR #1115 merged by Steven (migration 0157 — V1 soft-delete) |
| 2026-05-28T05:02:28Z | Migrations 0146–0152 applied to production (deploy-migrations workflow run 26555749401) |
| 2026-05-28T05:04:22Z | Migrations 0153–0157 applied to production (see §"Incident: 0157 applied without approval gate") |
| 2026-05-28T05:15Z | Triage complete — zero V1 rows affected; 0157 was a no-op |

### Migrations applied to production

| Migration | Description | Risk |
|---|---|---|
| 0146–0151 | Insights + PG17 compat (backlog) | SAFE |
| 0152 | publish_due atomic claim (TOCTOU fix) | SAFE |
| 0153 | platform_staff_audit_log table | SAFE |
| 0154 | approver_user_id nullable, approver_email column | SAFE |
| 0155 | social_post_drafts: link_url + source_type columns | SAFE |
| 0156 | social_post_drafts: bundle_post_id column + index | SAFE |
| 0157 | V1 soft-delete (sets deleted_at on all V1 rows) | WRITE-SAFETY-CRITICAL |

---

## Incident: Migration 0157 Applied Without Per-Migration Approval Gate

### What happened

The per-migration approval protocol used a two-dispatch sequence:
1. **Dispatch A** — `repair_versions_applied: "0153 0154 0155 0156 0157"` to
   temporarily mark later migrations as applied, forcing `supabase db push` to
   run only migration 0152.
2. **Dispatch B** — `repair_versions_reverted: "0153 0154 0155 0156 0157"` to
   clear the fake markers, restoring those migrations as pending.

The flaw: `deploy-migrations.yml` always runs `supabase db push --include-all`
as its final step. After Dispatch B reverted 0153–0157 from "applied" back to
"pending", the push step immediately applied all five — including 0157 — without
Steven's explicit per-migration approval.

### Triage (2026-05-28T05:15Z)

| Query | Result |
|---|---|
| V1 posts soft-deleted by 0157 | **0** |
| V1 variants soft-deleted by 0157 | **0** |
| V1 schedule entries cancelled by 0157 | **0** |
| V2 drafts backfilled from V1 | **0** |
| Migrations 0155/0156/0157 in schema_migrations | **applied** |

Production had no active V1 data before 0157 ran. Migration 0157 was a no-op.
No rollback required.

### Root cause

The `deploy-migrations.yml` workflow was not designed for per-migration approval.
Its repair inputs were intended for out-of-band schema drift recovery, not for
surgical per-migration deployment. Using `repair_versions_reverted` as a "restore
pending" step always triggers a subsequent full push.

### Fix / lesson learned

**Do not use the repair mechanism for per-migration approval gating.** The
correct approach for deploying a specific migration without running later ones:
mark the later migrations as applied (Dispatch A), verify the target applied, then
use a **separate no-op dispatch with no repair inputs and no pending migrations**
to confirm state before restoring via `repair_versions_reverted`.

Alternatively, add a `skip_push: true` input to `deploy-migrations.yml` so
repair-only dispatches can complete without triggering `supabase db push`.

The `deploy-migrations.yml` workflow should be updated before the next
write-safety-critical migration sequence.

---

## All Feature PRs

### V1→V2 Migration PRs (merged to main)

| PR | Branch | Description |
|---|---|---|
| #1094 | feat/v1-to-v2-pr01 | V2 schema foundation (migration 0150) |
| #1101 | feat/v1-to-v2-pr02 | V2 CRUD API |
| #1102 | feat/v1-to-v2-pr03 | V2 approval workflow |
| #1103 | feat/v1-to-v2-pr04 | V1→V2 backfill script |
| #1104 | feat/v1-to-v2-pr05 | V2 schedule endpoint |
| #1105 | feat/v1-to-v2-pr06 | V2 publish-due cron |
| #1106 | feat/v1-to-v2-pr07 | Post creation → V2 |
| #1107 | feat/v1-to-v2-pr08 | Analytics dual-lookup |
| #1108 | feat/v1-to-v2-pr09 | Webhook handler dual-lookup |
| #1109 | feat/v1-to-v2-pr10 | Publish pipeline dual-lookup |
| #1110 | feat/v1-to-v2-pr11 | Composer dual-lookup |
| #1111 | feat/v1-to-v2-pr12 | Retire V1 watchdog/backfill crons |
| #1112 | feat/v1-to-v2-pr13 | Retire V1 QStash publish pipeline |
| #1113 | feat/v1-to-v2-pr14 | V2 approval notify |
| #1114 | feat/v1-to-v2-pr15 | Analytics V2 dual-lookup unit tests |
| #1115 | feat/v1-to-v2-pr16-v1-soft-delete | **WRITE-SAFETY-CRITICAL** V1 soft-delete |
| #1117 | ci/staging-backfill-workflow | Staging backfill workflow |
| #1118 | ci/force-index-staging-backfill | Workflow indexing fix |
| #1119 | ci/fix-staging-backfill-db-query | Fixed `supabase db execute` → `supabase db query` |
| #1120 | ci/fix-backfill-on-conflict-partial-index | Fixed `ON CONFLICT` partial index predicate |
| #1121 | docs/v1v2-session-status-final | Session status documentation |

### Not yet merged (requires cleanup sprint)

| PR | Branch | Status |
|---|---|---|
| #1116 | feat/v1-to-v2-pr17-v1-table-drop | Open — NOT READY. Requires cleanup sprint to remove 68+ V1 references from TypeScript code before DROP TABLE can run. |

---

## Staging Verification Evidence

All checks run 2026-05-27/28:

| Check | Result | GH Actions Run |
|---|---|---|
| Migration 0155 applied to staging | ✅ | 26514058393 |
| Migration 0156 applied to staging | ✅ | 26514058393 |
| Backfill dry-run | ✅ v1=0, v2_migrated=0 | 26514058393 |
| Backfill live run | ✅ SQL clean, 0 rows | 26515335308 |
| Migration 0157 applied to staging | ✅ | 26533092370 |
| v1_posts_active after 0157 (staging) | ✅ = 0 | 26533092370 |
| UAT harness (post-backfill) | ✅ 42 pass | 26515462512 |
| UAT harness (post-0157) | ✅ 42 pass | 26533150229 |

Note: 1 pre-existing P1 visual failure (`calendar grid — current month render`)
is present in every staging UAT run — date-sensitive screenshot, unrelated to
this migration.

---

## Remaining Work

### 1. V1 code cleanup sprint

Before PR #1116 (DROP TABLE) can be merged, remove all TypeScript references to
V1 tables from production code paths. The V1 tables still exist in schema to
allow this to be done safely.

Tables to remove references to (in production code — not tests, not migration
utilities):
- `social_post_master`
- `social_post_variant`
- `social_schedule_entries`
- `social_publish_attempts`
- `social_publish_jobs`
- `social_approval_requests`
- `social_approval_recipients`

Approach: one cleanup PR per domain, <500 lines each. UAT harness after each PR.

### 2. PR #1116 — DROP TABLE

Only after:
- All V1 code references removed
- 7-day production soak (no V1 data writes)
- Full E2E suite passes with V1 tables absent

### 3. deploy-migrations.yml — skip_push input

Add a `skip_push: boolean` workflow_dispatch input so repair-only operations
don't trigger `supabase db push`. Prevents recurrence of the 0157 incident.

---

## Production Verification Checklist

- [x] Migrations 0146–0157 applied to production
- [x] v1_posts_soft_deleted_by_0157 = 0 (triage confirmed)
- [x] v2_drafts_from_v1_migration = 0 (production had no V1 data)
- [x] publish-due cron present in vercel.json (every minute)
- [ ] publish-due cron returning 200 (blocked by middleware — PR #1123)
- [ ] V1 code cleanup sprint complete
- [ ] PR #1116 merged (DROP TABLE)
