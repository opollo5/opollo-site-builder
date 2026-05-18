# Database Schema Delta

This document defines the exact schema changes for the composer rebuild. Existing tables are described where the composer touches them; new tables and columns are listed in full.

The corresponding migration SQL files are in `../migrations/`. Apply them in numeric order (0131 → 0134).

---

## 1. Existing tables (read-only, for context)

### `social_post_drafts` (already exists from migration 0112)

Columns the composer reads or writes. Do NOT alter existing columns; only ADD new ones via migrations 0131–0134.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `company_id` | uuid | NOT NULL, FK → `companies.id` | Owning company |
| `created_by_user_id` | uuid | NOT NULL, FK → `auth.users.id` | Author |
| `state` | text | NOT NULL, default `'draft'` | Enum-as-text; see §3 below |
| `content` | text | NOT NULL, default `''` | Post body (markdown allowed) |
| `media_urls` | text[] | NOT NULL, default `'{}'` | Public URLs from `social-media-uploads` bucket |
| `target_profiles` | jsonb | NOT NULL, default `'[]'` | Array of `{ profile_id: uuid, platform: text }` |
| `platform_variants` | jsonb | NOT NULL, default `'{}'` | `{ [platform]: { content?: string, link?: string, cta?: string } }` |
| `scheduled_at` | timestamptz | NULL | When to publish; required if state in `('scheduled', 'pending_approval')` |
| `approval_required` | boolean | NOT NULL, default false | Approval toggle in composer |
| `approver_user_id` | uuid | NULL, FK → `auth.users.id` | Assigned approver; null = company default |
| `created_at` | timestamptz | NOT NULL, default `now()` | |
| `updated_at` | timestamptz | NOT NULL, default `now()` | Updated via trigger |

### `social_connections` (already exists)

The composer reads this to populate the profile selector. Do not modify.

Relevant columns:
- `id` (uuid, PK)
- `company_id` (uuid, FK)
- `platform` (text, enum: `linkedin`, `facebook`, `instagram`, `x`, `google_business_profile`, `pinterest`, `tiktok`)
- `account_name` (text)
- `account_avatar_url` (text)
- `bundle_social_account_id` (text) — used to publish

---

## 2. New columns (migration 0131 — `0131_recurring_drafts.sql`)

Add to `social_post_drafts`:

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `parent_draft_id` | uuid | FK → `social_post_drafts.id` ON DELETE CASCADE | NULL | Child rows reference their recurring parent |
| `recurrence_rule` | text | NULL | NULL | RFC 5545 RRULE string. Parent rows only. |
| `recurrence_state` | text | NULL | NULL | One of `'active'`, `'paused'`, `'ended'`. Parent rows only. |
| `occurrence_index` | integer | NULL | NULL | 0-indexed position within the recurring series. Child rows only. |

Indexes:
- `idx_social_post_drafts_parent_id` on `parent_draft_id` (for fetching all children of a recurring parent)

Constraint:
- Add CHECK: `(parent_draft_id IS NULL AND recurrence_rule IS NOT NULL) OR (parent_draft_id IS NOT NULL AND recurrence_rule IS NULL) OR (parent_draft_id IS NULL AND recurrence_rule IS NULL)` — a row is either a recurring parent, a child of one, or neither.

---

## 3. New columns (migration 0132 — `0132_planned_for_at.sql`)

Add to `social_post_drafts`:

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `planned_for_at` | timestamptz | NULL | NULL | Save-as-draft "planned for" hint. Does NOT trigger auto-publish. |

Index:
- `idx_social_post_drafts_planned_for_at` on `planned_for_at` WHERE `state = 'draft'` (partial index for dashboard query)

### State machine — the canonical enum-as-text values for `state`

All locked here. Migration includes a CHECK constraint enforcing this set.

| Value | Meaning |
|---|---|
| `draft` | Saved without scheduling. `planned_for_at` may be set. |
| `pending_approval` | Submitted with approval toggle ON. Awaiting approver action. |
| `rejected` | Approver rejected. `rejection_reason` populated. |
| `scheduled` | Approved (or no approval needed). QStash job enqueued. `scheduled_at` populated. |
| `recurring` | Recurring parent row. Children may be in `scheduled` or `pending_approval`. |
| `paused` | Recurring parent paused. Future children deleted. |
| `publishing` | Active publish in flight. Set by QStash worker. |
| `published` | Successfully published. `published_at` and `published_url` populated. |
| `failed` | Publish failed. `last_publish_error` populated. User can retry. |

Migration adds: `CHECK (state IN ('draft', 'pending_approval', 'rejected', 'scheduled', 'recurring', 'paused', 'publishing', 'published', 'failed'))`.

---

## 4. New columns (migration 0133 — `0133_published_metadata.sql`)

Add to `social_post_drafts`:

| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `published_at` | timestamptz | NULL | NULL | Actual publish time from bundle.social |
| `published_url` | text | NULL | NULL | Destination platform URL (LinkedIn post URL, FB post URL, etc.) |
| `last_publish_error` | jsonb | NULL | NULL | `{ code, message, attempted_at, attempt_number }` |
| `publish_attempts` | integer | NOT NULL | 0 | Incremented on each retry |

Index:
- `idx_social_post_drafts_published_at` on `published_at` DESC WHERE `state = 'published'`

---

## 5. New table (migration 0134 — `0134_analytics_cache.sql`)

`social_post_analytics_cache` — the **cold storage / fallback layer** behind Upstash Redis.

Two-layer caching: Redis is the hot layer (60s TTL, ~2ms reads). This Postgres table is the cold layer that gets read when Redis is unavailable OR when the bundle.social analytics API is returning errors and we need a last-known-good value to return as `is_stale: true`. It also serves as historical record of analytics fetches over time.

Write path: every successful bundle.social analytics fetch writes to BOTH Redis (TTL 60s) and Postgres (no TTL — kept for 90 days, then daily cleanup cron purges).

Read path: Redis first, then Postgres if Redis fails or misses, then bundle.social if Postgres misses too.

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | `gen_random_uuid()` |
| `draft_id` | uuid | NOT NULL, FK → `social_post_drafts.id` ON DELETE CASCADE | — |
| `fetched_at` | timestamptz | NOT NULL | `now()` |
| `impressions` | integer | NULL | NULL |
| `engagement_rate` | numeric(5,2) | NULL | NULL |
| `reactions` | integer | NULL | NULL |
| `shares` | integer | NULL | NULL |
| `comments` | integer | NULL | NULL |
| `clicks` | integer | NULL | NULL |
| `platform_specific` | jsonb | NOT NULL | `'{}'` |

Indexes:
- `idx_social_post_analytics_cache_draft_id_fetched_at` on `(draft_id, fetched_at DESC)` — fetch latest per draft

RLS:
- ENABLE row level security
- POLICY `select_own_company`: `auth.uid()` must be in `company_users` for the owning draft's company

---

## 6. New table (migration 0134 — `social_post_approval_decisions`)

Same migration file as the analytics cache.

Tracks every approve/reject action for audit purposes.

| Column | Type | Constraints | Default |
|---|---|---|---|
| `id` | uuid | PK | `gen_random_uuid()` |
| `draft_id` | uuid | NOT NULL, FK → `social_post_drafts.id` ON DELETE CASCADE | — |
| `approver_user_id` | uuid | NOT NULL, FK → `auth.users.id` | — |
| `decision` | text | NOT NULL, CHECK in `('approved', 'rejected')` | — |
| `rejection_reason` | text | NULL, CHECK `char_length(rejection_reason) BETWEEN 30 AND 500` when decision = `'rejected'` | NULL |
| `decided_at` | timestamptz | NOT NULL | `now()` |
| `escalation_level` | integer | NOT NULL | 0 | 0 = primary approver, 1 = 48h escalation, 2 = 72h escalation, 3 = auto-reject |

Indexes:
- `idx_social_post_approval_decisions_draft_id` on `draft_id`

RLS: same as analytics cache.

---

## 7. Migration application order

```bash
# From repo root
psql $DATABASE_URL -f migrations/0131_recurring_drafts.sql
psql $DATABASE_URL -f migrations/0132_planned_for_at.sql
psql $DATABASE_URL -f migrations/0133_published_metadata.sql
psql $DATABASE_URL -f migrations/0134_analytics_cache.sql
psql $DATABASE_URL -f migrations/0135_cron_infrastructure.sql
```

Or via the Opollo migration runner if it exists (check `package.json` scripts for `db:migrate` or equivalent).

After applying, verify with:

```sql
\d social_post_drafts
\d social_post_analytics_cache
\d social_post_approval_decisions
\d cron_heartbeats
\d service_health_events
```

Every column listed in this document should be present.

---

## 7.1. Migration 0135 — cron heartbeats + service health events

See `migrations/0135_cron_infrastructure.sql` for the full DDL. Summary:

### `cron_heartbeats`

One row per cron job. Each handler updates its row on successful completion. Heartbeat-check cron flags stale rows.

| Column | Type | Constraints |
|---|---|---|
| `job_name` | text | PK |
| `last_run_at` | timestamptz | NOT NULL |
| `last_status` | text | CHECK in `('ok', 'error')` |
| `last_error` | jsonb | NULL |
| `run_count` | integer | NOT NULL, default 0 |

Seeded with the 6 known job names (publish-due, cleanup-cache, escalate-approvals, health-check, health-digest, heartbeat-check) so the first heartbeat-check doesn't false-alarm.

### `service_health_events`

Records every external-service failure detected by `withHealthMonitoring` + every manual admin flag.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | PK |
| `service_name` | text | NOT NULL |
| `operation` | text | NULL |
| `event_type` | text | CHECK in 9 values (see SERVICE_HEALTH.md §4) |
| `severity` | text | CHECK in `('info', 'warning', 'critical')` |
| `occurrence_count` | integer | NOT NULL, default 1 |
| `first_seen_at` | timestamptz | NOT NULL, default NOW() |
| `last_seen_at` | timestamptz | NOT NULL, default NOW() |
| `resolved_at` | timestamptz | NULL — set when admin resolves OR auto-recovers |
| `notified_at` | timestamptz | NULL — set when admin notification fired |
| `details` | jsonb | NOT NULL, default `{}` |
| `raised_by_user_id` | uuid | NULL — set on manual flag |

Three indexes: active events (partial), recent events (timeline), needs-notify (partial on severity).

RLS: platform_admin role only. System-detected events written via service role; manual flags written via user role with check that event_type='manual_flag' and raised_by_user_id=auth.uid().

---

## 8. RLS policy summary

All composer-related tables use the same RLS pattern:

- **SELECT/INSERT/UPDATE/DELETE** allowed if `auth.uid()` belongs to `company_users` with role `platform_admin` or `content_creator` for the owning company.
- **Read-only** for `viewer` role.
- **Approver actions** require role `approver` OR `platform_admin`.
- **Service role bypasses RLS** for QStash workers and CAP automation jobs.

Existing helper function (if not present, create in migration 0134):

```sql
CREATE OR REPLACE FUNCTION auth.user_belongs_to_company(company_id uuid) RETURNS boolean ...
```

Use this function in policies rather than re-implementing the check.
