# Schema Inventory — V1 → V2 Social Post Model

Investigation date: 2026-05-27. All claims cite migration file:line.

---

## V1 Tables

### `social_post_master` (0070_platform_foundation.sql:384–397)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, gen_random_uuid() | |
| `company_id` | UUID | NOT NULL, FK → platform_companies ON DELETE CASCADE | |
| `state` | social_post_state | NOT NULL DEFAULT 'draft' | Enum — see below |
| `source_type` | social_post_source | NOT NULL DEFAULT 'manual' | Enum: manual, csv, cap, api |
| `master_text` | TEXT | nullable | |
| `link_url` | TEXT | nullable | |
| `created_by` | UUID | nullable, FK → platform_users ON DELETE SET NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `state_changed_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | Updated by trg_post_master_state_change |
| `reviewer_comment` | TEXT | nullable, added 0078 | Stores rejection/changes comment |

**Indexes:**
- `idx_post_master_company_state` ON (company_id, state) — 0070:396
- `idx_post_master_state_changed` ON (state_changed_at) — 0070:397

**RLS:** `post_master_access` policy — ALL for staff OR company member — 0070:682–684

**Triggers:**
- `trg_post_master_updated` — sets updated_at via set_updated_at() — 0070:587–589
- `trg_post_master_state_change` — stamps state_changed_at when state changes — 0070:604–606

**Stored functions that write to this table:**
- `submit_post_for_approval` (0071) — flips state draft→pending_client_approval
- `record_approval_decision` (0072) — flips state on external-token approval
- `cancel_post_approval` (0073) — reverts pending_client_approval→draft
- `claim_publish_job` (0075, 0090, 0094, 0096) — flips state approved/scheduled→publishing
- `retry_publish_attempt` (0076, 0091, 0092, 0094) — reads master_id from variant

---

### `social_post_variant` (0070_platform_foundation.sql:399–413)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, gen_random_uuid() | |
| `post_master_id` | UUID | NOT NULL, FK → social_post_master ON DELETE CASCADE | |
| `platform` | social_platform | NOT NULL | Enum: linkedin_personal, linkedin_company, facebook_page, x, gbp |
| `connection_id` | UUID | nullable, FK → social_connections ON DELETE SET NULL | |
| `variant_text` | TEXT | nullable | Override of master_text for this platform |
| `is_custom` | BOOLEAN | NOT NULL DEFAULT false | |
| `scheduled_at` | TIMESTAMPTZ | nullable | Deprecated in favour of schedule_entries |
| `media_asset_ids` | UUID[] | DEFAULT '{}' | Refs to social_media_assets |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Constraints:**
- UNIQUE (post_master_id, platform) — 0070:411 — prevents duplicate variants per platform

**Indexes:**
- `idx_post_variant_master` ON (post_master_id) — 0070:412
- `idx_post_variant_scheduled` ON (scheduled_at) WHERE scheduled_at IS NOT NULL — 0070:413

**RLS:** `post_variant_access` — staff OR EXISTS company-member check via post_master — 0070:687–698

**Trigger:** `trg_post_variant_updated` — sets updated_at — 0070:590–592

---

### `social_schedule_entries` (0070_platform_foundation.sql:507–517)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, gen_random_uuid() | |
| `post_variant_id` | UUID | NOT NULL, FK → social_post_variant ON DELETE CASCADE | |
| `scheduled_at` | TIMESTAMPTZ | NOT NULL | When to fire |
| `qstash_message_id` | TEXT | nullable | Set after QStash enqueue; NULL = needs backfill |
| `scheduled_by` | UUID | nullable, FK → platform_users ON DELETE SET NULL | |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `cancelled_at` | TIMESTAMPTZ | nullable | Soft-cancel; NULL = active |

**Indexes:**
- `idx_schedule_entries_variant` ON (post_variant_id) — 0070:516
- `idx_schedule_entries_pending` ON (scheduled_at) WHERE cancelled_at IS NULL — 0070:517

**RLS:** `schedule_entries_access` — staff OR EXISTS company-member via variant→master chain — 0070:726–734

**Note:** This table is the QStash enqueue anchor. `claim_publish_job` RPC locks on this row.

---

## V2 Tables

### `social_post_drafts` (built across migrations 0112, 0127, 0131, 0132, 0133, 0136, 0152)

Full column set assembled from all migrations:

| Column | Type | Constraints | Migration | Notes |
|--------|------|-------------|-----------|-------|
| `id` | UUID | PK, gen_random_uuid() | 0112:23 | |
| `company_id` | UUID | NOT NULL, FK → platform_companies ON DELETE CASCADE | 0112:25 | |
| `created_by` | UUID | NOT NULL, FK → auth.users ON DELETE CASCADE | 0112:26 | Note: FK to auth.users, not platform_users |
| `updated_by` | UUID | NOT NULL, FK → auth.users | 0112:27 | |
| `draft_version` | INT | NOT NULL DEFAULT 1 | 0112:28 | Optimistic CAS per ADR-0002 |
| `draft_data` | JSONB | NOT NULL DEFAULT '{}' | 0112:29 | Legacy blob (Spec 22 V1 path). Contains master_text, media_refs, target_connection_ids, schedule, approval_required, ai_metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 0112:30 | |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT NOW() | 0112:31 | |
| `archived_at` | TIMESTAMPTZ | nullable | 0112:32 | Soft-delete |
| `state` | TEXT | NOT NULL DEFAULT 'draft', CHECK constraint (0132) | 0127:20 | Values: draft, pending_approval, rejected, scheduled, recurring, paused, publishing, published, failed |
| `content` | TEXT | NOT NULL DEFAULT '' | 0127:21 | Plain-text post body |
| `media_urls` | TEXT[] | NOT NULL DEFAULT '{}' | 0127:22 | Direct URL array (not asset IDs) |
| `target_profiles` | JSONB | NOT NULL DEFAULT '[]' | 0127:23 | Array of {profile_id: uuid} |
| `platform_variants` | JSONB | NOT NULL DEFAULT '{}' | 0127:24 | Per-platform overrides: {platform: {content?, link?, cta?}} |
| `scheduled_at` | TIMESTAMPTZ | nullable | 0127:26 | When to publish |
| `approval_required` | BOOLEAN | NOT NULL DEFAULT false | 0127:27 | |
| `approver_user_id` | UUID | nullable, FK → auth.users | 0127:28 | Named approver for internal platform flow |
| `parent_draft_id` | UUID | nullable, FK → social_post_drafts ON DELETE CASCADE | 0131:8 | Recurring post parent link |
| `recurrence_rule` | TEXT | nullable | 0131:9 | RFC 5545 RRULE string |
| `recurrence_state` | TEXT | nullable, CHECK IN ('active','paused','ended') | 0131:12 | |
| `occurrence_index` | INTEGER | nullable | 0131:11 | Child position in recurrence series |
| `planned_for_at` | TIMESTAMPTZ | nullable | 0132:8 | "Save as draft for this date" hint |
| `published_at` | TIMESTAMPTZ | nullable | 0133:9 | |
| `published_url` | TEXT | nullable | 0133:10 | |
| `last_publish_error` | JSONB | nullable | 0133:11 | {code, message, attempted_at, attempt_number} |
| `publish_attempts` | INTEGER | NOT NULL DEFAULT 0 | 0133:12 | |
| `batch_id` | UUID | nullable | 0136:8 | Groups rows from one CSV upload; used by rate limiter |
| `recurrence_starting_at` | TIMESTAMPTZ | nullable | 0136:9 | RRULE start bound |
| `recurrence_until` | TIMESTAMPTZ | nullable | 0136:10 | RRULE end bound |
| `publish_claimed_at` | TIMESTAMPTZ | nullable | 0152:29 | Atomically set when claim loop takes row |
| `publish_worker_id` | TEXT | nullable | 0152:30 | Worker that claimed the row; diagnostic |

**Also exists but not in base 0112 migration:** `idempotency_key` column referenced in `lib/platform/social/drafts.ts:79` — this column is used in code (`eq("idempotency_key", params.idempotencyKey)`) but there is no migration explicitly adding it. This is a schema gap that must be verified before migration.

**Constraints (0131):**
- `social_post_drafts_recurrence_shape` — parent_draft_id and recurrence_rule cannot both be set
- `social_post_drafts_recurrence_state_valid` — recurrence_state enum values

**State constraint (0132:19–31):**
```
CHECK state IN ('draft','pending_approval','rejected','scheduled','recurring','paused','publishing','published','failed')
```

**Indexes:**
- `idx_social_post_drafts_company` ON (company_id, archived_at) WHERE archived_at IS NULL — 0112
- `idx_social_post_drafts_created_by` ON (created_by, updated_at DESC) WHERE archived_at IS NULL — 0112
- `idx_social_post_drafts_updated` ON (updated_at DESC) — 0112
- `idx_social_post_drafts_scheduled` ON (scheduled_at) WHERE state='scheduled' AND scheduled_at IS NOT NULL — 0127
- `idx_social_post_drafts_pending_approval` ON (created_at DESC) WHERE state='pending_approval' — 0127
- `idx_social_post_drafts_parent_id` ON (parent_draft_id) WHERE parent_draft_id IS NOT NULL — 0131
- `idx_social_post_drafts_planned_for_at` ON (planned_for_at) WHERE state='draft' AND planned_for_at IS NOT NULL — 0132
- `idx_social_post_drafts_published_at` ON (published_at DESC) WHERE state='published' AND published_at IS NOT NULL — 0133
- `idx_social_post_drafts_batch_id` ON (batch_id) WHERE batch_id IS NOT NULL — 0136
- `idx_social_post_drafts_scheduled_for_claim` ON (scheduled_at) WHERE state='scheduled' AND archived_at IS NULL — 0152

**RLS (0112:50–68):**
- `social_post_drafts_company_editors` FOR ALL — company member with role IN ('editor','approver','admin')

---

### `social_post_approval_decisions` (0134_analytics_cache.sql:49–91)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | UUID | PK, gen_random_uuid() | |
| `draft_id` | UUID | NOT NULL, FK → social_post_drafts ON DELETE CASCADE | |
| `approver_user_id` | UUID | NOT NULL, FK → auth.users | Internal platform user only — external approvers get NULL per D5 |
| `decision` | TEXT | NOT NULL, CHECK IN ('approved','rejected') | Note: 'changes_requested' is a V1 state but is NOT a valid decision value here |
| `rejection_reason` | TEXT | nullable | Required when decision='rejected' (30–500 chars) |
| `decided_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| `escalation_level` | INTEGER | NOT NULL DEFAULT 0, CHECK BETWEEN 0 AND 3 | |

**Constraint:**
- `rejection_reason_required_when_rejected` — rejection_reason NOT NULL and 30–500 chars when decision='rejected'

**Indexes:**
- `idx_social_post_approval_decisions_draft_id` ON (draft_id) — 0134:66

**RLS:**
- `select_own_company` FOR SELECT — via social_post_drafts.company_id + is_company_member()
- `insert_as_approver` FOR INSERT — approver_user_id = auth.uid() AND company member

---

## State/Status Enum Comparison

### V1: `social_post_state` enum (0070:123–134)

Values:
1. `draft`
2. `pending_client_approval`
3. `approved`
4. `rejected`
5. `changes_requested`
6. `pending_msp_release` (added 0097 — "lock out pending MSP release" migration)
7. `scheduled`
8. `publishing`
9. `published`
10. `failed`

TypeScript mirror: `SocialPostState` in `lib/platform/social/posts/types.ts:5–14`

Note: `pending_msp_release` was added in 0097_lock_out_pending_msp_release.sql to gate batch releases. It is NOT in the TypeScript type (see 0097 for context).

### V2: `state` TEXT column with CHECK constraint (0132:19–31)

Values:
1. `draft`
2. `pending_approval`
3. `rejected`
4. `scheduled`
5. `recurring`
6. `paused`
7. `publishing`
8. `published`
9. `failed`

TypeScript mirror: `DraftState` in `lib/social/types.ts:20–28`

### Enum Mapping Table (DI-006)

| V1 state | V2 equivalent | Notes |
|----------|---------------|-------|
| `draft` | `draft` | Direct 1:1 |
| `pending_client_approval` | `pending_approval` | Renamed — remove `_client` |
| `approved` | **NO EQUIVALENT** | V2 has no approved-but-not-yet-scheduled state. In V2 approval → immediately `scheduled`. |
| `rejected` | `rejected` | Direct 1:1 |
| `changes_requested` | **NO EQUIVALENT** | V2 collapses this into `rejected`. The V2 approve route only emits 'approved' or 'rejected'. |
| `pending_msp_release` | **NO EQUIVALENT** | MSP-specific batch-release gate. V2 has no equivalent. |
| `scheduled` | `scheduled` | Direct 1:1 |
| `publishing` | `publishing` | Direct 1:1 |
| `published` | `published` | Direct 1:1 |
| `failed` | `failed` | Direct 1:1 |
| _(none)_ | `recurring` | V2-only — recurring post parent/template state |
| _(none)_ | `paused` | V2-only — paused recurrence series |

**Critical gaps requiring product decisions:**
1. `approved` state: V2 skips the approved-but-not-scheduled holding state. Does the product still need it?
2. `changes_requested`: V2 collapses to `rejected`. Does the editor/approver feedback loop need to be preserved?
3. `pending_msp_release`: Not present in V2 at all. Is batch-release gating still required?
