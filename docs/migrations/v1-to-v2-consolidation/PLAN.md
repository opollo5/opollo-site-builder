# PLAN — V1 → V2 Social Post Model Migration

Decision D3 (docs/inventory/decisions-locked.md:38–43): "Sunset V1. Migrate all functionality to V2. Separate dedicated workstream."

Investigation date: 2026-05-27. All claims cite file:line from schema-inventory.md, code-paths.md, data-snapshot.md.

---

## Executive Summary

The codebase currently runs two parallel social post pipelines:

- **V1** (N-series, `social_post_master` / `social_post_variant` / `social_schedule_entries`): The original platform design, shipped in 0070. Full state machine, external approval tokens, QStash-based publishing, rich per-attempt audit trail. Backed by ~50 lib files and 7 Postgres stored procedures across 5 crons.

- **V2** (Spec 22 / composer rebuild, `social_post_drafts` / `social_post_approval_decisions`): The newer, simpler JSONB-first design with inline scheduling, FOR UPDATE SKIP LOCKED publish cron, and a simplified approval model. Backed by ~9 lib files, 2 crons, no stored procedures.

Both pipelines are live and running simultaneously today. Posts enter V1 via `POST /api/platform/social/posts` (and the CAP generator). Posts enter V2 via `POST /api/platform/social/drafts` (and the composer). There is no shared data — they are entirely separate object models.

**Effort estimate: 10–14 days across 20–24 PRs** at a pace of one to two PRs per day, with a mandatory freeze window after the data migration PR and before V1 table drop.

---

## Recommended Strategy: Feature-by-Feature Parallel-Write → Hard Cutover

### Why not big-bang?
A single PR replacing all V1 paths simultaneously would be 1,500–2,000 net lines, violates the 500-line PR ceiling (CLAUDE.md), and creates a single high-risk deploy with no rollback window on individual features.

### Why not parallel-write (dual-write)?
Dual-write (writing every create/update to both V1 and V2 simultaneously) is safe but expensive: it doubles the complexity of every mutation path for the duration of the migration, and the V1/V2 data models are different enough (JSONB vs columns, different FK targets, different state names) that dual-write logic would be substantial and error-prone.

### Recommended: Feature-by-Feature with a State Freeze

1. **Schema prep** (PRs 1–3): Add V2 schema gaps (link_url column, source_type column, idempotency_key migration verification) so V2 can hold all V1 data without loss.
2. **Data backfill** (PR 4): One-time migration script: read every V1 post and insert a corresponding V2 draft row. This is a Steven-merge PR (write-safety-critical).
3. **Route cutover** (PRs 5–14): For each feature area, switch the route/lib to read from and write to V2. V1 tables stay in place but receive no new writes once their feature area is cut over.
4. **V1 read-only verification** (PR 15): After all routes are cut over, remove V1 write paths. V1 tables remain in DB as read-only archive for 30 days.
5. **V1 table drop** (PRs 16–17): Drop V1 tables + stored procedures. Final cleanup. Steven-merge.

This strategy means at most one feature area is in transition at any time, each PR is independently rollback-able, and the V1 tables survive long enough to recover from any missed edge case.

---

## PR Sequence

**Dependencies: each phase must complete before the next phase starts. Within a phase, PRs in the same number group can be parallelised.**

---

### Phase 0 — Prerequisites

**PR-01: Schema gaps — add link_url + source_type to social_post_drafts**
- Files: new migration 0154_v2_schema_gaps.sql
- What: `ALTER TABLE social_post_drafts ADD COLUMN IF NOT EXISTS link_url TEXT; ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual' CHECK (source_type IN ('manual','csv','cap','api'));`
- Also: verify idempotency_key column exists or add it
- Size: ~20 lines
- Risk: LOW — additive only
- Tests: migration integration test asserting column exists
- Rollback: DROP COLUMN (no data yet)

**PR-02: V2 source attribution — update lib/insights/source-attribution.ts for V2**
- Files: `lib/insights/source-attribution.ts`
- What: Rewrite traversal to use `social_post_drafts.source_type` directly rather than the V1 publish_attempt→variant→master chain. Add fallback to V1 chain for historical posts (those will still be in social_post_master until drop).
- Size: ~40 lines
- Risk: LOW — analytics path, not in critical publish path
- Tests: update `lib/__tests__/insights-dashboard-period.unit.test.ts` + source-attribution unit test

**PR-03: V2 calendar-view — add link_url to calendar response**
- Files: `app/api/platform/social/drafts/calendar-view/route.ts`
- What: After PR-01 lands, remove the `link_url: null` hardcode at line 69 and select `link_url` from the drafts table
- Size: ~5 lines
- Risk: VERY LOW
- Tests: `lib/__tests__/calendar-view-cache.test.ts`
- Dependency: PR-01

---

### Phase 1 — Data Migration

**PR-04: V1 → V2 backfill migration script (Steven-merge, write-safety-critical)**
- Files: `scripts/migrate-v1-to-v2.ts` (new), `supabase/migrations/0155_v1_posts_retired.sql` (comment-only marker)
- What: Script reads every `social_post_master` row, maps state per DI-006 table, resolves `social_post_variant` rows into `platform_variants` JSONB, resolves `social_media_assets` UUIDs to storage URLs, inserts corresponding `social_post_drafts` rows. Idempotent via a `v1_migration_source_id` column added to social_post_drafts (or via idempotency_key = v1_post_master.id).
- Also must handle: schedule entries → scheduled_at on draft, approval_requests → state mapping
- Size: ~200 lines (script), ~10 lines (migration)
- Risk: HIGH — mutates data; requires Steven merge + staging run before production
- Tests: integration test against a seeded V1 dataset that verifies the mapping is correct
- Rollback: The V1 tables are not touched; archive the inserted V2 rows by batch_id
- **Hard stop: requires staging row counts before writing this script** (see data-snapshot.md)

---

### Phase 2 — Composer / Editorial Cutover

**PR-05: CAP generator → V2**
- Files: `lib/platform/social/cap/generator.ts`, `app/api/platform/social/cap/generate/route.ts`
- What: Replace `createPostMaster` + `upsertVariant` calls with `createDraft` (with source_type='cap'). CAP posts now land in social_post_drafts.
- Size: ~80 lines
- Risk: MEDIUM — CAP is a critical content generation path. The V1 RPC `submit_post_for_approval` will no longer be needed for CAP-generated posts.
- Tests: update `lib/__tests__/cap-image-trigger.test.ts`; add contract snapshot for new V2 draft shape
- Working analog: `lib/platform/social/drafts.ts:createDraft` is the target pattern

**PR-06: Bulk CSV → V2**
- Files: `lib/platform/social/posts/bulk-create.ts`, `app/api/platform/social/posts/route.ts` (CSV path)
- What: Replace `bulkCreatePostMasters` with batch insert into social_post_drafts (same pattern as the existing V2 bulk route at `app/api/platform/social/drafts/bulk/route.ts`)
- Size: ~60 lines
- Risk: MEDIUM — bulk CSV is a multi-row write. PostgREST batch insert requires all columns per MEMORY.md note.
- Tests: `tests/regressions/bulk-csv-requires-schedule-permission.test.ts` must continue to pass

**PR-07: Manual post create → V2 (retire POST /api/platform/social/posts)**
- Files: `app/api/platform/social/posts/route.ts`, add redirect or 410 after route is removed
- What: The POST handler currently writes to V1. After PR-04 backfill + PR-05/06 cutover of CAP and CSV, the manual-create path is the only remaining writer. Redirect to `/api/platform/social/drafts` or inline-migrate the route.
- Size: ~30 lines (redirect) or ~100 lines (inline migration)
- Risk: LOW post-backfill — manual creates are idempotent
- Tests: integration test for manual post creation via the new path

---

### Phase 3 — Approval Workflow Cutover

**PR-08: Internal approver decisions — already V2; retire V1 transitions**
- Files: `app/api/platform/social/posts/[id]/approve/route.ts`, `app/api/platform/social/posts/[id]/reject/route.ts`, `app/api/platform/social/posts/[id]/submit/route.ts`
- What: These routes (if they exist; they call `lib/platform/social/posts/transitions.ts`) must be removed or redirected to the V2 equivalents at `app/api/platform/social/drafts/[id]/approve`
- Size: ~50 lines per route removed
- Risk: MEDIUM — approval is a critical path; must verify no active pending_client_approval posts in V1 before removing
- Tests: regression test for approval decision on V2 draft

**PR-09: External approval route — V1 → V2 (`/api/approve/[token]/decision`)**
- Files: `app/api/approve/[token]/decision/route.ts`
- What: This route calls `recordApprovalDecision` which reads `social_post_master`. After backfill, all active approval requests are for V2 drafts. The route must be updated to work with V2 or redirected to `/api/review/[token]/decision`.
- Size: ~60 lines
- Risk: HIGH — external token approval is a critical user-facing flow. Tokens in flight (issued before cutover) must still work.
- Rollback: Dual-read V1 + V2 during 14-day token TTL window
- Tests: `tests/regressions/external-approver-magic-link.test.ts`

**PR-10: Viewer link calendar (`/viewer/[token]`) → V2**
- Files: `app/viewer/[token]/page.tsx`
- What: Currently reads social_post_master + social_post_variant + social_schedule_entries for the customer calendar. After backfill, switch to reading social_post_drafts with scheduled_at/published_at.
- Size: ~60 lines
- Risk: LOW — read-only surface, no mutations
- Tests: add e2e test for the viewer calendar showing a V2 draft

---

### Phase 4 — Scheduling Cutover

**PR-11: Scheduling create/cancel → V2**
- Files: `lib/platform/social/scheduling/create.ts`, `lib/platform/social/scheduling/cancel.ts`, `lib/platform/social/scheduling/list.ts`, `lib/platform/social/scheduling/list-company.ts`
- What: The V1 scheduling lib manages social_schedule_entries. In V2, `scheduled_at` is a column on the draft row. The create path must be replaced with a PATCH to the draft. The cancel path must revert state or set archived_at.
- Size: ~150 lines across 4 files
- Risk: HIGH — scheduling is a critical path; the V2 claim cron depends on `scheduled_at` being set correctly
- Tests: `lib/__tests__/social-scheduling.test.ts` needs full rewrite; add regression test for schedule creation via V2
- Note: The `canDo("schedule_post")` gate must be preserved

**PR-12: Backfill cron + watchdog crons → retire**
- Files: `app/api/cron/social-publish-backfill/route.ts`, `lib/platform/social/publishing/watchdog.ts`, `vercel.json`
- What: Remove `social-publish-backfill` and `social-publish-watchdog` cron entries from vercel.json after V2 publish-due cron has been the sole publisher for ≥7 days.
- Size: ~10 lines (vercel.json) + route files removed
- Risk: LOW once V1 publish pipeline is drained
- Tests: verify no cron entries reference the deleted routes

---

### Phase 5 — Publishing Pipeline Cutover

**PR-13: V1 QStash publish pipeline → retire**
- Files: `lib/platform/social/publishing/fire.ts`, `lib/platform/social/publishing/backfill.ts`, `lib/platform/social/publishing/enqueue.ts`, `lib/platform/social/publishing/retry.ts`, `lib/platform/social/publishing/list-attempts.ts`, `app/api/webhooks/qstash/social-publish/route.ts`
- What: The V2 publish-due cron uses FOR UPDATE SKIP LOCKED (lib/social/publishing/claim-due-drafts.ts). The V1 QStash pipeline (fire.ts + claim_publish_job RPC) is being replaced. After all schedule entries are drained (verified by `SELECT COUNT(*) FROM social_schedule_entries WHERE cancelled_at IS NULL AND scheduled_at > now()`), these files can be removed.
- Size: ~500 lines removed (net negative)
- Risk: HIGH — must confirm zero active V1 schedule entries before removing
- Tests: verify publish-due cron handles all test cases that fire.ts previously handled
- Note: This PR is the largest single deletion. It removes 6 files.

**PR-14: BSP webhook → update for V2 publish attempts**
- Files: `lib/platform/social/webhooks/process.ts`
- What: The webhook handler traverses publish_attempt→variant→master to update master state. After V1 pipeline retirement, there will be no new publish_attempts linking to V1. The handler must be updated to also look up V2 drafts by published_url or bundle_post_id stored on the draft row. Historical V1 webhook events can still be processed via the existing path until the drop.
- Size: ~80 lines
- Risk: MEDIUM — webhook processing is idempotent but important for published state accuracy
- Tests: `lib/__tests__/social-webhooks-bundlesocial.test.ts`

---

### Phase 6 — Analytics Cutover

**PR-15: BSP analytics → V2**
- Files: `lib/platform/social/analytics.ts`
- What: Currently reads social_post_master (state=published) + social_post_variant. After backfill, published posts are in social_post_drafts. Switch reads to V2.
- Size: ~100 lines
- Risk: LOW — analytics is not in the critical publish path
- Tests: update social-posts-dashboard.test.ts

---

### Phase 7 — Verification Freeze (no PRs)

7-day monitoring period after Phase 6. No V1 writes should be occurring. Verify via:
```sql
SELECT MAX(updated_at) FROM social_post_master;
SELECT MAX(updated_at) FROM social_post_variant;
SELECT MAX(created_at) FROM social_schedule_entries WHERE cancelled_at IS NULL;
```
If any of these timestamps are recent (< 7 days), investigate before proceeding to Phase 8.

---

### Phase 8 — V1 Table Drop (Steven-merge, write-safety-critical)

**PR-16: Retire V1 API routes + Postgres stored procedures**
- Files: routes under `app/api/platform/social/posts/`, all `lib/platform/social/posts/` directory, stored-procedure migrations 0071–0075 + 0076–0094 (DROP statements in a new migration)
- What: Drop the submit_post_for_approval, record_approval_decision, cancel_post_approval, claim_publish_job, retry_publish_attempt Postgres functions
- Size: ~100 lines (migration) + route files removed
- Risk: HIGH — destructive; must verify no callers remain
- Tests: audit:static must pass with no references to dropped RPC names

**PR-17: DROP V1 tables + related tables (Steven-merge)**
- Files: new migration `0156_drop_v1_social_tables.sql`
- What: Drop social_schedule_entries, social_post_variant, social_post_master (in dependency order). Also drop social_approval_requests, social_approval_recipients, social_approval_events, social_viewer_links if those flows have been fully migrated to V2 equivalents.
- Size: ~30 lines
- Risk: CRITICAL — irreversible. Requires staging verification + row count = 0 check before applying to production.
- Tests: integration test suite must pass with no references to dropped tables
- Rollback: none — this is the point of no return. Ensure a full DB backup exists.

---

## Risk Register

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|------------|
| R-1 | **Production V1 data lost during backfill** | Low | Critical | PR-04 is Steven-merge. Run against staging first. Verify row counts before + after. Backfill script is idempotent (uses v1_post_master.id as idempotency key). 30-day archive window before V1 drop. |
| R-2 | **Active V1 approval tokens (social_approval_recipients) expire or break mid-migration** | Medium | High | Approval tokens have 14-day TTL. During the token window, PR-09 must dual-read V1 + V2. The external approval route (`/api/approve/[token]/decision`) must continue working against V1 data until all tokens issued before cutover expire. Track token issuance in social_approval_events. |
| R-3 | **QStash messages in flight when V1 schedule pipeline is removed** | Medium | High | Before removing the QStash publish routes (PR-13), drain and cancel all V1 schedule entries with `UPDATE social_schedule_entries SET cancelled_at = now() WHERE scheduled_at > now() AND cancelled_at IS NULL`. Wait for in-flight publishes to complete (monitored via social_publish_attempts.status). |
| R-4 | **`approved` state gap causes drafts stuck after V1 approval** | Low | Medium | After backfill (PR-04), V1 `approved` maps to V2 `scheduled` (with `scheduled_at = NULL`). Editor must set a schedule. Resolved in OD-1 + D6. |
| R-5 | **BSP analytics source-attribution breaks for historical posts** | High | Low | The V1 `publish_attempt → variant → master.source_type` chain will work until PR-17 drops the tables. After drop, historical attribution will return 'composer' for all V1 posts (source_type lost). PR-02 can backfill source_type onto V2 drafts during the migration script to preserve the distinction. |
| R-6 | **`idempotency_key` column missing in production DB** | Medium | Medium | `lib/platform/social/drafts.ts:79` queries `eq("idempotency_key", ...)` but no migration file adds this column. If it was added via the Supabase dashboard or a migration not in the repo, the backfill script will silently fail on CAP retry paths. Verify before PR-04. |
| R-7 | **`social_media_assets` UUID → URL resolution fails for migrated posts** | Medium | Medium | V1 variant rows store media_asset_ids (UUIDs into social_media_assets). V2 stores URLs. The backfill script must join social_media_assets to get storage_path and construct the Supabase storage URL. If any asset row has been deleted, the migrated draft will have no media. |

---

## Out of Scope

The following are explicitly NOT being migrated in this workstream:

1. **`social_connections` table and all connection management** — The connection/identity model is V1 and is used by both old and new pipelines. Migrating it is a separate concern.
2. **`social_approval_requests` / `social_approval_recipients` / `social_approval_events` deep migration** — The V1 external approval system (with OTP, multi-approver rules, snapshot immutability) has no V2 equivalent. If the product wants to preserve these features for V2, that requires a separate design workstream.
3. **`social_viewer_links` (customer calendar magic links)** — V1-only table. Migrating the viewer link experience to use V2 data is in scope (PR-10 switches the reader), but the token table itself is out of scope unless a replacement is designed.
4. **`social_media_assets` to Cloudflare/direct URL migration** — V2 stores plain URLs. The media assets themselves are in Supabase storage. This workstream only ensures that migrated V1 posts have their asset URLs resolved; it does not move the media files.
5. **`social_publish_attempts` historical audit data** — The V1 publish attempt log will be dropped with the V1 tables. If historical attempt data needs preservation, it should be exported to analytics storage before PR-17.
6. **MSP batch-release (`pending_msp_release` state)** — No V2 equivalent exists. If the product still needs batch-release gating, this is a separate design + implementation workstream.
7. **`platform_social_profiles` / BSP analytics refresh cron** — These are V2-side features that already work. They are not being changed.
8. **CAP campaign management** — The `cap_campaign_posts` table and CAP generation pipeline changes are not in scope beyond switching the output model from V1 to V2 (PR-05).

---

## Decisions — Locked

All five open decisions resolved 2026-05-27 using locked decisions D1–D6
(`docs/inventory/decisions-locked.md`) plus conservative inference.

---

**OD-1 RESOLVED: `approved` state → V2 `scheduled` (with `scheduled_at = NULL`)**

Accept the V2 model (option a). Approval in V2 immediately transitions the
post to `scheduled` state. If `scheduled_at` is not set, the editor must
schedule it explicitly before it publishes. This matches the existing V2
approve route behaviour. The V2 UX already surfaces "scheduled with no date"
as a pending-schedule indicator.

Backfill mapping: V1 `approved` → V2 `scheduled` + `scheduled_at = NULL`.
See D6 (`docs/inventory/decisions-locked.md`).

---

**OD-2 RESOLVED: `changes_requested` → V2 `pending_approval` (conservative)**

V2 `rejected` is the terminal state. Posts that were in V1 `changes_requested`
are migrated to V2 `pending_approval` — they surface in the approver's queue
again. Going forward on V2, the approval workflow is: approve or reject (final).
If the editor needs to revise after a rejection, they create a new draft.

This is option (a) — reject-and-recreate — with the conservative migration
mapping ensuring no post silently advances. See D6.

Multi-round review (option b) is explicitly out of scope for this workstream.
If it's needed in future, it's a separate 1-PR addition.

---

**OD-3 RESOLVED: V1 approval richness NOT rebuilt for V2**

The V2 JWT magic-link model is sufficient. The rich V1 approval features
(OTP, multi-approver rules, snapshot immutability, event audit log) are
explicitly out of scope per the "Out of Scope" section above. The V2
`social_post_approval_decisions` table covers the shipped use case (D5).

If multi-approver richness is needed in future, it is a separate design
workstream. This workstream does not add it.

`social_approval_requests`, `social_approval_recipients`, `social_approval_events`,
and `social_viewer_links` are kept read-only in DB alongside V1 tables until
PR-17. No V2 equivalent is built here.

---

**OD-4 RESOLVED: `social_publish_attempts` kept as read-only archive for 90 days**

Option (b): keep the table in DB as a read-only archive after PR-17.
PR-17 does NOT drop `social_publish_attempts`. A follow-up migration
(PR-18, separate session) drops it after 90 days if row counts confirm
no live references.

Rationale: publishing audit data is high-value forensic evidence. Data loss
risk outweighs schema cleanliness. The table is renamed to
`_archive_social_publish_attempts` in PR-17 to make its read-only status
explicit and prevent accidental new writes.

---

**OD-5 RESOLVED: Treat as medium-scale migration, batch processing, off-peak**

Staging row counts were unavailable at planning time. Conservative assumption:
medium scale (hundreds to low thousands of rows). The backfill script (PR-04)
must:

1. Process in batches of 100 rows with a 200ms pause between batches
2. Be idempotent (skip already-migrated rows via `idempotency_key`)
3. Run during low-traffic hours (midnight–4am UTC)
4. Run against staging first; verify row counts before production run
5. Log progress to stdout in a format that shows rows processed / total

If staging row count comes back >10,000, the script pauses and prints a
warning requiring manual confirmation before continuing.
