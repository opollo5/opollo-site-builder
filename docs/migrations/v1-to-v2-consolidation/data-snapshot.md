# Data Snapshot — V1 vs V2 Column Comparison

Investigation date: 2026-05-27. Row counts from staging are NOT available (no direct DB access during this investigation). They are deferred — see the note at the end of this document.

---

## Side-by-Side Column Comparison

### Post Content / Identity

| Concept | V1 column (social_post_master) | V2 column (social_post_drafts) | Gap |
|---------|-------------------------------|-------------------------------|-----|
| Post body text | `master_text TEXT` | `content TEXT` | Renamed. V1 NULL-default, V2 NOT NULL DEFAULT ''. V1 allows empty post (null/blank), V2 enforces non-null. |
| Link URL | `link_url TEXT` | **Not a column — only in draft_data JSONB blob** | The calendar-view route explicitly comments: `link_url: null, // link_url is not a column on social_post_drafts` (app/api/platform/social/drafts/calendar-view/route.ts:68). This is a gap. |
| Source type | `source_type social_post_source` ('manual','csv','cap','api') | `batch_id UUID` (groups CSV batches) + source inferred from context | V1 has an explicit source enum. V2 has no equivalent source_type column. CAP source attribution will break (lib/insights/source-attribution.ts traverses V1 tables). |
| Company | `company_id UUID NOT NULL` | `company_id UUID NOT NULL` | Same |
| Creator | `created_by UUID` (FK → platform_users, nullable) | `created_by UUID NOT NULL` (FK → auth.users, NOT NULL) | V1: FK to platform_users, nullable. V2: FK to auth.users, NOT NULL. FK target differs. |
| Updated by | Not present | `updated_by UUID NOT NULL` (FK → auth.users) | V2-only |
| Version / CAS | Not present | `draft_version INT NOT NULL DEFAULT 1` | V2-only optimistic concurrency |
| State | `state social_post_state` (Postgres ENUM type) | `state TEXT` with CHECK constraint | Type system differs — ENUM vs constrained TEXT. See DI-006 section below. |

### Per-Platform Content

| Concept | V1 | V2 | Gap |
|---------|----|----|-----|
| Per-platform text | `social_post_variant.variant_text TEXT` (separate row per platform) | `platform_variants JSONB` field within social_post_drafts (`{platform: {content?, link?, cta?}}`) | Architecture change: V1 uses sibling rows; V2 uses JSONB within the single draft row. |
| Target accounts | `social_post_variant.connection_id UUID` (FK → social_connections) | `target_profiles JSONB` (array of `{profile_id: uuid}`, FK → platform_social_profiles concept) | V1 links to social_connections; V2 links to platform_social_profiles. Connection model differs. |
| Platform list | `social_post_variant.platform social_platform` ENUM | `platform_variants` JSONB keys (string) | V1 ENUM: linkedin_personal, linkedin_company, facebook_page, x, gbp. V2 strings include instagram, pinterest, tiktok (lib/social/types.ts:10–17). V2 supports more platforms. |
| Media | `social_post_variant.media_asset_ids UUID[]` (FK refs to social_media_assets) | `media_urls TEXT[]` (direct URLs) | Architecture change: V1 stores asset IDs referencing social_media_assets rows. V2 stores plain URLs. |

### Scheduling

| Concept | V1 | V2 | Gap |
|---------|----|----|-----|
| Scheduled time | `social_schedule_entries.scheduled_at TIMESTAMPTZ` (separate row) | `social_post_drafts.scheduled_at TIMESTAMPTZ` (inline column) | Architecture: V1 puts this in a separate child table; V2 is inline. |
| Schedule cancel | `social_schedule_entries.cancelled_at TIMESTAMPTZ` | `state` ('draft' reverts) or `archived_at` | V1 has explicit cancel trail; V2 uses state + soft-delete |
| QStash anchor | `social_schedule_entries.qstash_message_id TEXT` | Not present — V2 publish cron uses FOR UPDATE SKIP LOCKED poll | V2 abandons QStash-per-entry in favour of a polling cron |
| Scheduled by | `social_schedule_entries.scheduled_by UUID` (FK → platform_users) | Not present | V1 tracks who scheduled; V2 doesn't |
| Multiple schedules per post | UNIQUE (post_variant_id) — one per platform variant | Multiple rows in social_post_drafts with same content | V1 allows one schedule per variant via constraint; V2 allows multiple draft rows |
| Recurring posts | Not present | `parent_draft_id`, `recurrence_rule`, `recurrence_state`, `recurrence_starting_at`, `recurrence_until`, `occurrence_index` | V2-only feature |
| "Planned for" hint | Not present | `planned_for_at TIMESTAMPTZ` | V2-only "save draft for this date" |

### Approval

| Concept | V1 | V2 | Gap |
|---------|----|----|-----|
| Approval metadata | `social_approval_requests` table with `snapshot_payload JSONB`, `expires_at`, `approval_rule`, etc. | `social_post_approval_decisions` table (simpler) + `approver_user_id` on draft | V1 approval is much richer: it has recipients, magic-link tokens, OTP codes, multi-approver rules, snapshot immutability. V2 approval is a single-user, single-decision record. |
| Approval recipients | `social_approval_recipients` table with per-recipient token_hash, OTP support | Not present | V2 has no external-recipient token table; uses JWT review links instead |
| Approval events | `social_approval_events` table (full event log: viewed, identity_bound, comment_added, etc.) | Not present | V2 has no approval event audit log |
| Reviewer comment | `social_post_master.reviewer_comment TEXT` (0078) | Rejection reason in `social_post_approval_decisions.rejection_reason` | Different storage — V1 denormalises to master row; V2 stores in decision log |
| Viewer links | `social_viewer_links` table (90-day customer calendar links) | Not present in V2 | V2 has no equivalent customer-facing viewer link table |

### Publishing

| Concept | V1 | V2 | Gap |
|---------|----|----|-----|
| Publish jobs | `social_publish_jobs` table | Not present | V2 has no publish_jobs table — publish state is tracked directly on the draft row |
| Publish attempts | `social_publish_attempts` table (immutable audit log, retry tracking, error classification) | `publish_attempts INT` counter + `last_publish_error JSONB` + `published_at` on draft | V1 has full per-attempt audit trail. V2 only stores last error and attempt count. |
| Claim / worker tracking | Via RPC `claim_publish_job` using schedule_entries | `publish_claimed_at TIMESTAMPTZ + publish_worker_id TEXT` inline on draft (0152) | Different claiming mechanism |
| Published URL | Not directly — on `social_publish_attempts.platform_post_url` | `published_url TEXT` on draft | V2 denormalises published URL onto draft row |
| Webhook reconciliation | `social_publish_attempts.bundle_post_id TEXT` — webhook matches this | Not present in V2 publish pipeline | V2 cron does not use bundle.social webhooks to confirm publish |

### Soft Delete / Archive

| Concept | V1 | V2 |
|---------|----|----|
| Deletion model | Hard delete (social_post_master delete cascades to variants/schedule/approval) | Soft delete via `archived_at` |

---

## DI-006: State Enum Divergence (Full Reference)

V1 enum (`social_post_state`, 0070:123–134):
```
draft → pending_client_approval → approved → scheduled → publishing → published
                                ↓          (or)
                          changes_requested
                                ↓
                              draft (reopen)
                          rejected (terminal)
pending_msp_release (batch-release gate, 0097)
failed (terminal)
```

V2 CHECK constraint values (0132:20–30):
```
draft → pending_approval → scheduled → publishing → published
                         ↓
                      rejected (terminal)
recurring (parent of a recurrence series)
paused (recurrence paused)
failed (terminal)
```

### Missing V2 equivalents — impact:

**`approved` (V1 only)**
V1 flow: draft → pending_client_approval → approved (holding state while editor schedules) → scheduled
V2 flow: pending_approval → scheduled (approval immediately schedules)
Impact: The V1 dashboard has an "approved" stat tile (`lib/platform/social/posts/dashboard.ts:56`). V2 calendar-view has no approved state. The dashboard will lose the "approved but not yet scheduled" count. If the product wants to preserve this holding state for V2, a new `approved` value must be added to the V2 CHECK constraint.

**`changes_requested` (V1 only)**
V1: Approver can request changes (distinct from rejected). Editor receives comment, reopens for editing, resubmits.
V2: Only 'rejected' terminal state. The V2 approve route (`app/api/platform/social/drafts/[id]/approve/route.ts:72`) maps approved→scheduled, rejected→rejected. No changes_requested path exists.
Impact: Editor/approver feedback loop is less expressive in V2. If multi-round review is needed, this requires a new V2 state.

**`pending_msp_release` (V1 only)**
Added in 0097 migration to gate batch releases. No V2 equivalent. If MSP batch-release is still a feature, it must be added to V2.

---

## Runtime Paths: Which Crons Use V1 vs V2

From `vercel.json` analysis:

| Cron path | Schedule | Model | Note |
|-----------|----------|-------|------|
| `/api/cron/social-publish-backfill` | `*/5 * * * *` | V1 | Backfills social_schedule_entries + retries failed social_publish_attempts |
| `/api/cron/social-publish-watchdog` | `*/5 * * * *` | V1 | Watches for stale social_publish_attempts (stuck in_flight) |
| `/api/internal/cron/publish-due` | `* * * * *` | V2 | Claims + publishes social_post_drafts state='scheduled' |
| `/api/internal/cron/escalate-approvals` | `0 */6 * * *` | V2 | Escalates stale social_post_drafts in pending_approval |
| `/api/cron/social-analytics-refresh` | `0 4 * * *` | V1 (via analytics.ts) | Refreshes BSP analytics — reads social_post_master for published posts |
| `/api/cron/insights-feature-extract` | `*/15 * * * *` | Neither (reads social_post_analytics_snapshots) | Indirectly depends on V1 via source-attribution chain |

**Both V1 and V2 publish crons run simultaneously today.** Posts created via `/api/platform/social/posts` (V1) flow through the QStash/backfill/watchdog pipeline. Posts created via `/api/platform/social/drafts` (V2) flow through the publish-due cron. There is no deduplication between the two pipelines.

---

## Staging Row Counts

**Staging row counts: requires DB query, deferred.**

To obtain actual counts, run against staging Supabase:
```sql
SELECT
  (SELECT COUNT(*) FROM social_post_master)             AS v1_post_master,
  (SELECT COUNT(*) FROM social_post_variant)            AS v1_post_variant,
  (SELECT COUNT(*) FROM social_schedule_entries)        AS v1_schedule_entries,
  (SELECT COUNT(*) FROM social_post_drafts WHERE archived_at IS NULL) AS v2_drafts_active,
  (SELECT COUNT(*) FROM social_post_drafts WHERE archived_at IS NOT NULL) AS v2_drafts_archived,
  (SELECT COUNT(*) FROM social_post_approval_decisions) AS v2_approval_decisions;
```

These counts are critical for the migration plan: if V1 tables have significant production data, the migration requires a non-trivial backfill script; if they are empty or near-empty (V1 was never fully rolled out to customers), the migration simplifies to a cutover + table retirement.

---

## Key Data Model Gaps (Pre-Migration Requirements)

These gaps must be resolved before a data migration script can be written:

1. **`link_url` not a column in social_post_drafts.** Referenced in draft_data JSONB blob only. Must add as a top-level column or accept loss of link_url for calendar display.
2. **`source_type` absent from social_post_drafts.** CAP attribution in `lib/insights/source-attribution.ts` traverses the V1 tables. After migration, source attribution will break unless source_type is added to V2 or the attribution logic is rewritten to use batch_id or another signal.
3. **`created_by` FK target differs.** V1 → platform_users. V2 → auth.users. Users who are in platform_users but not directly in auth.users (edge case) may not map cleanly.
4. **Rich approval model not replicated.** The V1 social_approval_requests / social_approval_recipients / social_approval_events / social_viewer_links tables have no direct V2 equivalents. Post-migration, external-token approval (app/api/approve/[token]/decision/) using V1 tables will break.
5. **social_media_assets referenced by V1 only.** V1 variant rows reference social_media_assets by UUID. V2 stores URLs directly. If migrated drafts contain media, the media_asset_ids must be resolved to URLs before insertion into V2.
6. **`idempotency_key` column in social_post_drafts is referenced in code but has no migration file.** This must be verified against the actual DB schema before any query relying on it is executed.
