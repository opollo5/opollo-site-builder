# Build Order — Composer Workstream

Eight PRs (A through H) in strict dependency order. **Do not skip ahead.** Each PR has:

- **Scope** — exact files to create or modify
- **Dependencies** — prior PRs that must be merged first
- **Verification gate** — commands that must pass before the PR is considered done

If a gate fails, fix it in the same PR. Do not create follow-up PRs for gate failures.

All PRs ship behind `FEATURE_COMPOSER_V2`. The old composer remains mounted in parallel until cutover (out of scope for this brief).

---

## PR A — Schema delta

**Scope:**
- Apply migrations `0131_recurring_drafts.sql`, `0132_planned_for_at.sql`, `0133_published_metadata.sql`, `0134_analytics_cache.sql`, `0135_cron_infrastructure.sql` (in `../migrations/`).
- Update `lib/social/types.ts` with the type definitions from `COMPONENT_MAP.md` §"Type definitions."
- Add Zod schemas in `lib/social/schemas/` mirroring the new columns.
- Update existing draft repo accessor functions (if any in `lib/social/drafts/`) to handle the new columns.
- Confirm `cron_heartbeats` is seeded with the 6 known job names.

**Dependencies:** None.

**Verification gate:**
```bash
# Migrations apply cleanly on a fresh test database
pnpm db:reset
pnpm db:migrate

# Schema matches
psql $DATABASE_URL -c "\d social_post_drafts" | grep -q "parent_draft_id"
psql $DATABASE_URL -c "\d social_post_drafts" | grep -q "planned_for_at"
psql $DATABASE_URL -c "\d social_post_drafts" | grep -q "published_url"
psql $DATABASE_URL -c "\d social_post_analytics_cache"
psql $DATABASE_URL -c "\d social_post_approval_decisions"
psql $DATABASE_URL -c "\d cron_heartbeats"
psql $DATABASE_URL -c "\d service_health_events"

# cron_heartbeats seeded
psql $DATABASE_URL -c "SELECT COUNT(*) FROM cron_heartbeats" | grep -q "6"

# State CHECK constraint exists and rejects invalid values
psql $DATABASE_URL -c "INSERT INTO social_post_drafts (company_id, created_by_user_id, state, content) VALUES (gen_random_uuid(), gen_random_uuid(), 'invalid_state', '');" 2>&1 | grep -q "social_post_drafts_state_valid"

# Type generation succeeds
pnpm typecheck

# Existing tests still pass
pnpm test lib/social
```

All nine commands must succeed (or, for the constraint test, fail at the expected place). Done condition: typecheck + test pass and the constraint test prints the expected violation.

---

## PR B — API surface + service health monitor + cron infrastructure

**Scope:**

**B.1 — Service health monitor (foundation; build first within this PR)**
- Create `lib/platform/service-health/` directory with:
  - `types.ts` — shared types
  - `classify.ts` — HTTP status → event_type mapper
  - `record.ts` — writes to `service_health_events` table; aggregates same-type events in 5-min windows
  - `monitor.ts` — exports `withHealthMonitoring(service, operation, fn)` wrapper
  - `notify.ts` — SendGrid + optional Slack. **Discovers recipients via `company_users WHERE role = 'platform_admin'` query, NOT an env var.** Includes self-monitoring exclusion (don't email about SendGrid via SendGrid; don't write to Redis when reporting on Redis).
  - `digest.ts` — daily digest generator
  - `recipients.ts` — `getPlatformAdminEmails()` helper that runs the DB query. Cached per-invocation to avoid repeated queries within one notify cycle.
- Add unit tests covering: 5xx classification, auth_failure classification, billing_failure classification, recovered event firing, notification rate limit (30min), SendGrid-as-failing-service skips email channel, Redis-as-failing-service skips Redis-based aggregation, `getPlatformAdminEmails` returns correct set when admins are added/removed.

**B.2 — Two-layer cache (Upstash Redis hot + Postgres cold)**
- Create `lib/platform/cache/index.ts` exporting `get(key, ttlSeconds)`, `set(key, value, ttlSeconds)`, `getStale(key)`.
- Internal:
  - `redis-cache.ts` — Upstash Redis client wrapper. EVERY call wrapped in try/catch. On error: record service-health event for `upstash-redis`, return `null`/`false` (treat as cache miss).
  - `postgres-cache.ts` — reads/writes `social_post_analytics_cache`. Read filter `fetched_at > NOW() - INTERVAL '<ttl> seconds'`.
- `get(key, ttl)`: Redis first → on miss/error → Postgres → on miss → return null.
- `set(key, value, ttl)`: writes to Redis AND Postgres in parallel. Postgres write proceeds even if Redis fails.
- `getStale(key)`: ignores freshness filter on Postgres; returns last known value for `is_stale: true` fallback when bundle.social fails.
- **Critical:** the cache layer NEVER throws to the caller. All errors are caught + logged via `withHealthMonitoring`. Caller treats cache as best-effort.

**B.3 — Rate limiter (Upstash Ratelimit primary, Postgres fallback)**
- Use the Upstash Ratelimit primitive (already in the Opollo stack via Upstash Redis dependency) as the primary rate limiter.
- Wrap calls in try/catch — on Redis failure, fall through to `lib/platform/rate-limit/postgres-rate-limit.ts` which counts rows in a bucket table OR uses `pg_advisory_lock` per identifier.
- For bulk-CSV (3/hour/company): count rows in `social_post_drafts` created in the last hour with `batch_id IS NOT NULL` for the company. No new table needed.
- For per-user (60/min): counter table `rate_limit_buckets (identifier, window_start, count)` with advisory-lock-protected increment.
- **Critical:** rate-limit failures NEVER bypass — if BOTH Redis and Postgres rate-limit checks fail (Postgres outage), return 503 to the caller. Never silently allow.

**B.4 — API endpoints (per `API_CONTRACTS.md`)**
- `app/api/platform/social/drafts/route.ts` (POST)
- `app/api/platform/social/drafts/[id]/route.ts` (GET, PATCH, DELETE)
- `app/api/platform/social/drafts/[id]/approve/route.ts` (POST)
- `app/api/platform/social/drafts/[id]/analytics/route.ts` (GET) — uses `postgres-cache`
- `app/api/platform/social/drafts/[id]/review-link/route.ts` (GET)
- `app/api/platform/social/drafts/bulk/route.ts` (POST) — uses `postgres-rate-limit`
- `app/api/platform/social/drafts/calendar-view/route.ts` (GET)
- `app/api/webhooks/bundle-social/route.ts` (POST)
- Every call into `bundle-social-client.ts`, `sendgrid-client.ts`, `anthropic-client.ts`, `ideogram-client.ts` wrapped in `withHealthMonitoring`.

**B.5 — Cron handlers**
- `app/api/internal/cron/publish-due/route.ts` — picks up `state = 'scheduled' AND scheduled_at <= NOW()` via `FOR UPDATE SKIP LOCKED`, publishes via bundle.social wrapper, updates state. Writes heartbeat.
- `app/api/internal/cron/heartbeat-check/route.ts` — finds stale heartbeats, records `cron_stale` events.
- `app/api/internal/cron/health-check/route.ts` — finds unresolved critical events with `notified_at IS NULL OR notified_at < NOW() - INTERVAL '30 min'`, fires notifications.
- `app/api/internal/cron/cleanup-cache/route.ts` — deletes `social_post_analytics_cache` rows >90 days old.
- `app/api/internal/cron/escalate-approvals/route.ts` — per `DECISIONS_LOCKED.md` Q4 — 48h/72h/96h logic.
- `app/api/internal/cron/health-digest/route.ts` — daily digest email.
- Each cron verifies `Authorization: Bearer ${CRON_SECRET}` header (Vercel auto-injects).
- Each cron updates `cron_heartbeats` for its job_name on successful completion.

**B.6 — Vercel cron config**
- Update `vercel.json` at repo root with the 6 cron entries from `composer/ENV.md` §"Vercel cron configuration".

**B.7 — Supporting libraries**
- Create `lib/social/bulk-csv/parse.ts` — the canonical CSV parser used by `/drafts/bulk` AND by CAP. Export `parseCsv(input: string): { rows: ParsedRow[]; errors: ValidationError[] }`.
- Create `lib/social/publishing/bundle-social-client.ts` — wrapper around bundle.social SDK or fetch calls. All methods wrapped in `withHealthMonitoring`.
- Create `lib/social/approval/notify-approver.ts` — SendGrid + Slack notification sender (wrapped in `withHealthMonitoring`).
- Create `lib/social/approval/escalate.ts` — 48h/72h/96h escalation logic. Called by the escalate-approvals cron.

**Dependencies:** PR A.

**Verification gate:**
```bash
# Service health monitor tests pass
pnpm test lib/platform/service-health

# Cache + rate limit tests pass
pnpm test lib/platform/cache lib/platform/rate-limit

# All endpoints respond to a basic OPTIONS or auth-protected request
curl -X POST http://localhost:3000/api/platform/social/drafts -H "Content-Type: application/json" -d '{}' | grep -q "401\|400"

# Bulk parser unit tests pass
pnpm test lib/social/bulk-csv

# Integration test: create a draft, fetch it, update it, delete it
pnpm test app/api/platform/social/drafts

# Webhook signature verification rejects bad signatures
pnpm test app/api/webhooks/bundle-social

# Publish-due cron: simulate a scheduled draft, hit endpoint, verify state advances
pnpm test app/api/internal/cron/publish-due

# Heartbeat-check cron: simulate stale heartbeat, verify cron_stale event raised
pnpm test app/api/internal/cron/heartbeat-check

# Health-check cron: simulate critical event, verify SendGrid call (mocked)
pnpm test app/api/internal/cron/health-check

# Cleanup-cache cron: seed old rows, verify deletion
pnpm test app/api/internal/cron/cleanup-cache

# Typecheck still passes
pnpm typecheck
```

---

## PR C — Composer shell + profile selector

**Scope:**
- Create `components/ui/callout.tsx`, `components/ui/section-header.tsx`, `components/ui/empty-state.tsx` (or conform existing), `components/ui/pagination.tsx` (per `COMPONENT_MAP.md` §"New primitives"). These primitives are needed by D onwards AND by the framework workstream.
- Create `components/social/composer/ComposerOverlay.tsx` — the split-pane shell.
- Create `components/social/composer/ProfileSelector.tsx` — the chip row + cascading "Add profile" dropdown.
- Create `components/social/composer/PreviewCard.tsx` — per-platform preview rendering.
- Create `components/social/composer/MiniCalendar.tsx`.
- Create `hooks/use-composer-state.ts`.
- Mount the composer overlay from a placeholder dashboard page at `app/(platform)/social/poster/page.tsx`. The dashboard is finished in PR F; this PR just gets the composer mountable.

**Reference:** wireframes `02-composer-idle.html`, `03-composer-with-content.html`, `11-add-profile-dropdown.html`.

**Dependencies:** PR B (composer mounts but performs real API calls in PR D+).

**Verification gate:**
```bash
# Component story renders without error
pnpm storybook:build  # or pnpm test:components if no Storybook

# Visual regression baseline (Playwright)
pnpm test:e2e composer --grep "shell renders"

# Composer overlay opens and closes via state hook
pnpm test hooks/use-composer-state

# Typecheck
pnpm typecheck

# Lint
pnpm lint
```

---

## PR D — Content editor + per-platform variants + tools

**Scope:**
- Create `components/social/composer/ComposerEditor.tsx` — orchestrates left pane.
- Create `components/social/composer/ContentEditor.tsx` — textarea + char counter + media tray.
- Create `components/social/composer/MediaTray.tsx` — image thumbnails + upload to `social-media-uploads` bucket.
- Create `components/social/composer/ToolsRow.tsx` — AI assistant, emoji picker, GIF picker, link shortener, UTM tags.
- Create `components/social/composer/CustomizeForRow.tsx` — per-platform variant chips.
- Create `components/social/composer/PlatformActionsList.tsx` — Add link / Add button / Add poll per platform.
- Wire AI assistant tool to `ANTHROPIC_API_KEY`.
- Wire GIF picker to `GIPHY_API_KEY`.
- Wire image upload to Supabase Storage `social-media-uploads`.

**Reference:** wireframes `03-composer-with-content.html`, `04-composer-multi-platform.html`.

**Dependencies:** PR C.

**Verification gate:**
```bash
# Editor renders with content, char counter updates on input
pnpm test:e2e composer --grep "content editor"

# Media upload writes to social-media-uploads bucket (use a test bucket in CI)
pnpm test:e2e composer --grep "media upload"

# Per-platform variants persist independently
pnpm test:e2e composer --grep "customize for"

# Char limit enforcement per platform
pnpm test:e2e composer --grep "char limit"

# Typecheck + lint
pnpm typecheck && pnpm lint
```

---

## PR E — Scheduling card + approval workflow

**Scope:**
- Create `components/social/composer/SchedulingCard.tsx` with four tabs: Post now, Schedule, Publish regularly, Save as draft.
- Create `components/social/composer/ScheduleRow.tsx` (date + time + delete).
- Create `components/social/composer/RecurrencePicker.tsx` — RRULE builder UI.
- Create `components/social/composer/ApprovalToggle.tsx`.
- Wire SchedulingCard to `POST /api/platform/social/drafts` with the right `mode` per active tab.
- Implement approval flow end-to-end:
  - Submit with approval ON → state = `pending_approval`, SendGrid + Slack notifications fired.
  - Approver hits `/review/<token>` route (new, lightweight page).
  - Approve/Reject calls `POST /drafts/[id]/approve`.
  - On approve: QStash job enqueued; on reject: author notified with `rejection_reason`.
- Create `app/(public)/review/[token]/page.tsx` — public review page.
- Create `app/api/internal/cron/escalate-approvals/route.ts` — daily escalation cron.

**Reference:** wireframes `05-composer-schedule.html`, `06-composer-publish-regularly.html`, `07-composer-save-as-draft.html`.

**Dependencies:** PR D.

**Verification gate:**
```bash
# All four scheduling modes create rows with correct state
pnpm test:e2e composer --grep "post now"
pnpm test:e2e composer --grep "schedule"
pnpm test:e2e composer --grep "publish regularly"
pnpm test:e2e composer --grep "save as draft"

# Recurring mode pre-generates 6 children
pnpm test:e2e composer --grep "recurring children"

# Approval flow: submit, email fires, approver approves, post enters scheduled
pnpm test:e2e composer --grep "approval happy path"

# Rejection requires 30-char reason
pnpm test:e2e composer --grep "rejection reason validation"

# Escalation cron promotes to fallback approver at 48h
pnpm test app/api/internal/cron/escalate-approvals

# Typecheck + lint + build
pnpm typecheck && pnpm lint && pnpm build
```

---

## PR F — Dashboard (calendar + day-detail) + empty-state callout

**Scope:**
- Replace placeholder `app/(platform)/social/poster/page.tsx` with the real dashboard.
- Create `components/social/dashboard/CalendarShell.tsx` — month grid + day-detail panel.
- Create `components/social/dashboard/CalendarCell.tsx` — single day cell with hover-reveal "+".
- Create `components/social/dashboard/PostChip.tsx` — chip inside a calendar cell.
- Create `components/social/dashboard/DayDetail.tsx` — right-side panel showing selected day's posts.
- Create `components/social/dashboard/DayDetailPostCard.tsx` — single post card with hover-reveal actions.
- Create `components/social/dashboard/FilterBar.tsx` — filter bar with New post + Bulk + profile filter + Month/Timeline toggle.
- Wire empty-state callout: if `social_connections.length === 0` for company, render the "Connect a Social Profile to Continue" callout per wireframe `00-dashboard-empty-state.html`.
- Implement Month + Timeline view modes.
- Implement drag-and-drop reschedule (per `COMPONENT_MAP.md` §"Drag-and-drop").
- Implement profile filter (URL param `?profiles=id1,id2`).

**Reference:** wireframes `00-dashboard-empty-state.html`, `01-dashboard-populated.html`.

**Dependencies:** PR E.

**Verification gate:**
```bash
# Calendar renders the current month with seeded posts
pnpm test:e2e dashboard --grep "month view"

# Clicking a cell selects it; day detail panel updates
pnpm test:e2e dashboard --grep "day select"

# Hover-reveal "+" opens composer pre-scheduled for that day
pnpm test:e2e dashboard --grep "cell add"

# Drag-and-drop reschedule: drop on another day, PATCH fires
pnpm test:e2e dashboard --grep "drag reschedule"

# Empty-state callout renders when zero connections
pnpm test:e2e dashboard --grep "empty state callout"

# Profile filter persists in URL
pnpm test:e2e dashboard --grep "profile filter"

# Month/Timeline toggle works
pnpm test:e2e dashboard --grep "view mode toggle"

# Typecheck + lint + build
pnpm typecheck && pnpm lint && pnpm build
```

---

## PR G — Bulk CSV upload modal

**Scope:**
- Create `components/social/dashboard/BulkScheduleModal.tsx` — modal with empty state, drag-and-drop, file picker, error preview table.
- Wire to `POST /api/platform/social/drafts/bulk`.
- Add "Download example" link that returns a hardcoded CSV with 3 example rows.
- Show validation errors inline with row + column highlighting.
- Add a rate-limit error state (429): "You've reached the upload limit for this hour. Try again in X minutes."

**Reference:** wireframes `09-bulk-csv-modal.html`, `09a-bulk-csv-uploaded.html`.

**Dependencies:** PR F (modal triggered from dashboard filter bar).

**Verification gate:**
```bash
# Valid CSV uploads and creates N drafts
pnpm test:e2e bulk-csv --grep "happy path"

# Invalid CSV shows row-level errors, NO drafts created (all-or-nothing per Q5)
pnpm test:e2e bulk-csv --grep "validation errors"

# Past-dated rows fail the whole upload
pnpm test:e2e bulk-csv --grep "past dated"

# Rate limit returns 429 after 3 uploads in 1 hour
pnpm test:e2e bulk-csv --grep "rate limit"

# Download example returns valid CSV
pnpm test:e2e bulk-csv --grep "example download"

# Shared parser is the same instance used by CAP
pnpm test lib/social/bulk-csv --grep "parser is shared"

# Typecheck + lint
pnpm typecheck && pnpm lint
```

---

## PR H — Post analytics modal

**Scope:**
- Create `components/social/dashboard/PostAnalyticsModal.tsx` — two-column modal with post render + metrics.
- Wire to `GET /api/platform/social/drafts/[id]/analytics` (cached via Upstash Redis).
- Reuse `PreviewCard` from PR C for the left-column rendering.
- Implement per-platform metric variation (LinkedIn shows Reactions/Shares/Comments/Clicks; GBP shows Views/Calls/Directions/Clicks; etc.).
- "Schedule again" button: opens composer pre-filled with the published post's content + target profiles, fresh `planned_for_at`.
- "Open post" button: opens `published_url` in a new tab.
- "More" button: dropdown with Delete, Duplicate, Copy link.

**Reference:** wireframe `10-post-analytics-modal.html`.

**Dependencies:** PR F (modal triggered from dashboard); PR D (PreviewCard exists).

**Verification gate:**
```bash
# Clicking a published post opens the modal
pnpm test:e2e analytics --grep "open from dashboard"

# Metrics load from cache on second open within 60s
pnpm test:e2e analytics --grep "cache hit"

# Stale flag set when bundle.social 5xx
pnpm test:e2e analytics --grep "stale on error"

# Schedule again opens composer pre-filled
pnpm test:e2e analytics --grep "schedule again"

# Per-platform metric variation
pnpm test:e2e analytics --grep "gbp metrics"
pnpm test:e2e analytics --grep "linkedin metrics"

# Typecheck + lint + build + full test suite
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

---

## PR I — Admin service-health dashboard (small follow-up)

**Scope:**
- Create `app/(platform)/admin/system/health/page.tsx` — service status grid + event timeline.
- Create `components/admin/health/ServiceStatusGrid.tsx` — one card per monitored service (bundle.social, Ideogram, SendGrid, Anthropic, Supabase, Vercel Cron).
- Create `components/admin/health/EventTimeline.tsx` — chronological event list with expand-for-details.
- Create `components/admin/health/BillingIssueDialog.tsx` — manual flag flow per `SERVICE_HEALTH.md` §8.
- Create `app/api/platform/admin/service-health/events/route.ts` (GET — list events) and `[id]/resolve/route.ts` (POST — mark resolved) and `flag/route.ts` (POST — manual flag).
- Route gated to `role = 'platform_admin'`.

**Dependencies:** PR B (health backend), PR H (composer composite gate green so the dashboard route lands in a stable repo).

**Verification gate:**
```bash
# Dashboard renders with seeded events
pnpm test:e2e admin-health --grep "service status grid"

# Non-platform-admin gets 403
pnpm test:e2e admin-health --grep "rbac"

# Manual flag flow creates an event and notifies (mocked)
pnpm test:e2e admin-health --grep "manual flag"

# Resolve flow updates resolved_at
pnpm test:e2e admin-health --grep "resolve"

# Typecheck + lint
pnpm typecheck && pnpm lint
```

---

## Final composite gate (run after PR I merges)

Before declaring the entire workstream done:

```bash
# 1. All unit + integration tests pass
pnpm typecheck
pnpm lint
pnpm build
pnpm test

# 2. End-to-end suite passes with feature flag ON
FEATURE_COMPOSER_V2=true pnpm test:e2e composer
FEATURE_COMPOSER_V2=true pnpm test:e2e dashboard
FEATURE_COMPOSER_V2=true pnpm test:e2e bulk-csv
FEATURE_COMPOSER_V2=true pnpm test:e2e analytics

# 3. Bundle size check (composer should add <80KB gzipped)
pnpm analyze | grep "composer" | awk '{print $NF}' | head -1

# 4. Lighthouse on the dashboard route
pnpm lighthouse /company/social/poster --threshold-performance=80 --threshold-a11y=95

# 5. Manual smoke (Claude Code can't run this — append to ACCEPTANCE.md DECISION_TRAIL with instructions for Steven)
echo "Steven: please run a manual end-to-end smoke per ACCEPTANCE.md §Manual smoke."
```

All five gates must pass. If anything fails, fix in the same PR-chain; do not declare done until they're green.
