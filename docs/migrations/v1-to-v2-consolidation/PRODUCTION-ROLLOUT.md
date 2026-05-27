# V1→V2 Social Post Model — Production Rollout

**Last updated**: 2026-05-27

## Overview

This doc covers the production rollout sequence for retiring the V1 social post
tables (`social_post_master`, `social_post_variant`, etc.) in favour of the V2
model (`social_post_drafts`).

---

## Completed (merged to main, deployed)

| PR | Description | Status |
|---|---|---|
| PR-01 (#1094) | V2 schema foundation — `social_post_drafts`, `social_post_approval_decisions` | ✅ Deployed |
| PR-02 (#1101) | V2 create/read/update/delete API | ✅ Deployed |
| PR-03 (#1102) | V2 approval workflow | ✅ Deployed |
| PR-04 (#1103) | V1→V2 backfill script (write-safety-critical) | ✅ Deployed |
| PR-05 (#1104) | V2 schedule endpoint | ✅ Deployed |
| PR-06 (#1105) | V2 publish-due cron | ✅ Deployed |
| PR-07 (#1106) | Post creation migrated to V2 | ✅ Deployed |
| PR-08 (#1107) | Analytics V2 dual-lookup | ✅ Deployed |
| PR-09 (#1108) | Webhook handler V2 dual-lookup | ✅ Deployed |
| PR-10 (#1109) | Publish pipeline V2 dual-lookup | ✅ Deployed |
| PR-11 (#1110) | Composer V2 dual-lookup | ✅ Deployed |
| PR-12 (#1111) | Retire V1 watchdog/backfill crons | ✅ Deployed |
| PR-13 (#1112) | Retire V1 QStash publish pipeline | ✅ Deployed |
| PR-14 (#1113) | V2 approval notify | ✅ Deployed |
| PR-15 (#1114) | V2 analytics dual-lookup | ✅ Deployed |

---

## In Flight

| PR | Description | Status |
|---|---|---|
| PR-16 (#1115) | Migration 0157 — soft-delete all V1 rows | CI running — Steven must merge |
| PR-17 (#1116) | Migration 0158 — DROP V1 tables | NOT READY — requires code cleanup sprint (68+ references) |
| #1117 | Staging backfill workflow | CI running — auto-merge when green |

---

## Rollout Sequence

### Step 1: Verify staging migrations (prerequisite)

Before any production writes, confirm staging DB is at migration 0156.

```bash
# Via GitHub Actions (workflow_dispatch):
gh workflow run "V1→V2 staging backfill" --ref main -f dry_run=true
```

Expected output: `v1_posts_active` equals `v2_migrated_from_v1`.

### Step 2: Run staging backfill (live)

```bash
gh workflow run "V1→V2 staging backfill" --ref main -f dry_run=false
```

Verify row counts match. Run UAT harness (expect 42+ pass).

### Step 3: Merge PR-16 (#1115) — soft-delete V1 staging data

**Steven must merge this PR.** It is write-safety-critical.

After merge, apply migration 0157 to staging:
```bash
gh workflow run "Apply Supabase migrations to staging" --ref staging
```

Verify:
```sql
SELECT COUNT(*) FROM social_post_master WHERE deleted_at IS NULL;
-- expected: 0
```

Run UAT harness again (expect 42+ pass).

### Step 4: Production backfill

Prerequisites: PR-16 deployed, staging verified, UAT green.

Run the TypeScript backfill script against production (requires
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`):
```bash
npx tsx scripts/migrate-v1-to-v2.ts --dry-run   # verify counts first
npx tsx scripts/migrate-v1-to-v2.ts              # live run
```

Document row counts in `backfill-verification.md`.

### Step 5: Apply migration 0157 to production

Via Supabase CLI or Vercel deploy (migration auto-applies on deploy).

Verify:
```sql
SELECT COUNT(*) FROM social_post_master WHERE deleted_at IS NULL;
-- expected: 0
SELECT COUNT(*) FROM social_post_drafts WHERE idempotency_key LIKE 'v1-migration-%';
-- should equal prior v1_posts_active count
```

### Step 6: PR-17 — table drop (future sprint)

NOT in scope for this session. Requires:
- Audit and remove/redirect all 68+ code references to V1 tables
- Verify no active API routes or crons use V1 tables
- Full E2E test suite pass with V1 tables dropped in a test environment

---

## Rollback Procedures

### Rollback migration 0157 (soft-delete)

```sql
-- Restore soft-deleted V1 rows stamped by the migration
-- (replace <migration_timestamp> with the actual timestamp from migration logs)
UPDATE social_post_master SET deleted_at = NULL
  WHERE deleted_at >= '<migration_timestamp>';
UPDATE social_post_variant SET deleted_at = NULL
  WHERE deleted_at >= '<migration_timestamp>';
UPDATE social_schedule_entries SET cancelled_at = NULL
  WHERE cancelled_at >= '<migration_timestamp>';
```

### Rollback V2 backfill

The backfill is additive-only (V1 rows not touched). To undo:

```sql
DELETE FROM social_post_drafts
  WHERE idempotency_key LIKE 'v1-migration-%';
```

### Rollback code PRs

All PRs in the V1→V2 sequence can be reverted individually because:
- The V2 schema coexists with V1 schema (no conflicting column names)
- All dual-lookup code gracefully falls back to V1 data
- The backfill is idempotent — re-running is safe

---

## Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Backfill runs before V2 code is live | High | PRs 01–15 all deployed before backfill runs |
| Soft-delete runs before backfill | Critical | Staging verification step gates production run |
| Table drop before code cleanup | Critical | PR-17 marked NOT READY; 68+ references must be cleared first |
| Backfill misses rows (null created_by) | Low | Logged + counted; these rows cannot be migrated (FK violation) |
| Duplicate keys on re-run | None | `ON CONFLICT (company_id, idempotency_key) DO NOTHING` |
| state mapping error | Low | CASE expression mirrors TypeScript `STATE_MAP` exactly; covered by unit tests |

---

## Verification Commands

```bash
# Check PR CI status
gh pr checks <PR_NUMBER>

# Check staging migration state
gh workflow run "Apply Supabase migrations to staging" --ref staging

# Check row counts (via supabase CLI linked to staging/production)
supabase db execute --linked -- "
  SELECT 'v1_posts_active' AS metric, COUNT(*) AS cnt
    FROM social_post_master WHERE deleted_at IS NULL
  UNION ALL
  SELECT 'v2_drafts_total', COUNT(*) FROM social_post_drafts
  UNION ALL
  SELECT 'v2_migrated_from_v1', COUNT(*)
    FROM social_post_drafts WHERE idempotency_key LIKE 'v1-migration-%';
"

# UAT harness
gh workflow run "UAT Harness" --ref staging
```
