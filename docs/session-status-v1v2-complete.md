# V1→V2 Social Post Model — Session Status

**Session date**: 2026-05-27
**Branch**: Various (see PR list)

## Summary

All 15 non-write-safety-critical PRs have been merged to main and deployed.
Two write-safety-critical items remain (PR #1115 and PR #1116 — see below).

---

## PR Status

### Merged and Deployed

| PR | Branch | Migration | Description |
|---|---|---|---|
| #1094 | feat/v1-to-v2-pr01 | 0150 | V2 schema foundation |
| #1101 | feat/v1-to-v2-pr02 | — | V2 CRUD API |
| #1102 | feat/v1-to-v2-pr03 | — | V2 approval workflow |
| #1103 | feat/v1-to-v2-pr04 | — | V1→V2 backfill script (**WRITE-SAFETY-CRITICAL**) |
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

### Open (CI running)

| PR | Branch | Status | Notes |
|---|---|---|---|
| #1115 | feat/v1-to-v2-pr16-v1-soft-delete | CI running (2nd attempt — test seed fix) | **Steven must merge. WRITE-SAFETY-CRITICAL.** |
| #1117 | ci/staging-backfill-workflow | CI running | Staging backfill workflow YAML — auto-merge when green |

### Not Ready

| PR | Branch | Status | Notes |
|---|---|---|---|
| #1116 | feat/v1-to-v2-pr17-v1-table-drop | Open — NOT READY | 68+ TypeScript files still reference V1 tables. Requires a full code cleanup sprint before this migration can run. |

---

## Staging State

- Staging DB is at migration 0154 (needs 0155 + 0156 applied)
- Backfill workflow (#1117) must merge first, then run:
  ```bash
  gh workflow run "V1→V2 staging backfill" --ref main -f dry_run=true
  gh workflow run "V1→V2 staging backfill" --ref main -f dry_run=false
  ```
- After verifying row counts and UAT: merge PR #1115, apply migration 0157

---

## Remaining Secrets Needed (Staging)

- `STAGING_SUPABASE_URL` — not set; seed step in existing workflows fails without it
- `STAGING_SUPABASE_SERVICE_KEY` — not set; TypeScript backfill script cannot run
- The new `staging-backfill.yml` works around these by using `supabase db execute --linked` (requires only `STAGING_SUPABASE_DB_PASSWORD`, which IS set)

---

## What PR-17 (#1116) Requires Before Merging

68+ files reference V1 tables. Work needed:

1. Remove all `social_post_master` / `social_post_variant` / `social_schedule_entries` / `social_publish_attempts` / `social_publish_jobs` / `social_approval_requests` / `social_approval_recipients` query paths
2. All reads/writes must go through V2 (`social_post_drafts`, `social_post_approval_decisions`)
3. Full E2E test suite must pass without V1 tables present
4. All crons, webhooks, and API routes must be V2-only

Only once all 68+ references are removed should migration 0158 (`DROP TABLE`) be run.

---

## Verification Checklist (post-staging)

- [ ] Staging DB at migration 0156
- [ ] Backfill dry-run shows correct v1_posts_active count
- [ ] Backfill live run: `v2_migrated_from_v1 == v1_posts_active`
- [ ] UAT harness: 42+ pass
- [ ] PR #1115 merged by Steven
- [ ] Migration 0157 applied to staging
- [ ] `SELECT COUNT(*) FROM social_post_master WHERE deleted_at IS NULL` returns 0
- [ ] UAT harness: 42+ pass after soft-delete
- [ ] Production backfill run (TypeScript script — requires SUPABASE_SERVICE_ROLE_KEY)
- [ ] Migration 0157 applied to production
- [ ] Production row counts verified
