# Social & Analytics Capabilities Audit

**Branch:** `audit/social-analytics-capabilities-20260523`
**Audit date:** 2026-05-23
**Auditor:** Claude Sonnet 4.6 (automated, read-only)
**Scope:** Social posting, analytics data layer, CAP integration, observability
**Method:** Static code + migration analysis. Local Supabase not running (Docker unavailable); all row counts, date ranges, and cardinality estimates are marked NOT AVAILABLE. Every structural claim cites a file:line.

---

## §10 Executive Summary

| Finding | Severity | Status |
|---|---|---|
| Engagement metrics inaccessible to company users | High | Gap — fix needed |
| X/Twitter analytics not supported by bundle.social API | Medium | By design — document |
| Performance priors not yet on main | Medium | Draft PR #997 pending |
| Recharts still in production code (ECharts mandate is docs-only) | Low | PR in progress |
| No competitor data capabilities | Low | By design |
| Cost cap uses 30-day rolling window, not calendar month | Low | Intentional — note in docs |

### Key findings

**1. The analytics UI shows the wrong data surface.** The company-facing analytics page (`/company/social/analytics`) queries `social_post_master` for publishing throughput (post counts, connection counts, scheduling trend). It does **not** query `social_post_analytics_snapshots`. Engagement metrics — impressions, likes, comments, shares, engagement rate — exist in the database but are only visible to Opollo staff via `/admin/companies/[id]/social-profiles/[profileId]/analytics`. This is the highest-priority gap for the social product: paying customers cannot see their post performance. Citation: `lib/platform/social/analytics.ts:88–157` (all queries from `social_post_master`); `lib/platform/social/analytics-ingest/dashboard.ts:113,130` (engagement queries admin-only).

**2. X/Twitter analytics explicitly unsupported.** `BundleSocialAnalyticsPlatform` does not include `"TWITTER"` and the platform map documents why: "X simply doesn't expose the analytics surface via their API." (`lib/platform/social/analytics-ingest/platform-map.ts:9–28`). This is a bundle.social API limitation, not a code gap.

**3. Performance priors feature is a draft PR, not on main.** `lib/cap/performance-priors.ts` does not exist on main. `post-generator.ts` on main has a fixed system message with no performance context injection. The feature (PR #997, `feat/cap-performance-priors`) is complete and unit-tested but awaiting merge.

**4. ECharts mandate is documentation only.** Two Recharts files remain in production: `components/SocialAnalyticsClient.tsx:17` and `components/analytics/ImpressionsTimeSeries.tsx:12`. The mandate and ESLint guardrail land in a separate follow-up PR.

**5. Solid data foundations.** The analytics schema (`0121_social_analytics_tables.sql`) is well-designed: `engagement_rate` is a STORED generated column (no compute at query time), three purpose-built indexes including a composite on `(profile_id, platform, engagement_rate DESC)`, proper RLS, and a 30-day bundle.social content-capture workaround (bundle.social purges post content after ~30 days; the schema captures it on first import).

**6. Publishing retry is robust; no circuit breaker.** Auto-retry backoff schedule is `[0, 30, 300, 1800, 7200, 43200]` seconds with max 5 retries (`lib/platform/social/publishing/auto-retry.ts:14`). No circuit breaker pattern was found.

---

## §1 Data Layer

### 1.1 `social_post_analytics_snapshots`

**Migration:** `supabase/migrations/0121_social_analytics_tables.sql` (lines 84–157)

**Purpose:** Daily per-post engagement snapshot. Content captured at first import because bundle.social purges raw post content after ~30 days (migration comment, lines 7–10).

**Schema (abridged):**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `profile_id` | UUID FK | → `platform_social_profiles(id) ON DELETE CASCADE` |
| `bundle_post_id` | TEXT NOT NULL | bundle.social post identifier |
| `platform` | `social_platform` | platform enum |
| `snapshot_date` | DATE NOT NULL | daily granularity |
| `posted_at` | TIMESTAMPTZ | original publish time |
| `title` | TEXT | captured at first import |
| `content` | TEXT | captured at first import; never updated |
| `media_urls` | TEXT[] | |
| `impressions` | BIGINT | |
| `impressions_unique` | BIGINT | |
| `views` | BIGINT | |
| `views_unique` | BIGINT | |
| `likes` | BIGINT | |
| `dislikes` | BIGINT | |
| `comments` | BIGINT | |
| `shares` | BIGINT | |
| `saves` | BIGINT | |
| `engagement_rate` | NUMERIC GENERATED | STORED; formula below |
| `raw` | JSONB | full bundle.social payload |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | auto-updated by trigger |

**`engagement_rate` formula** (`0121_social_analytics_tables.sql:112–115`):
```sql
engagement_rate NUMERIC GENERATED ALWAYS AS (
  (COALESCE(likes, 0) + COALESCE(comments, 0) + COALESCE(shares, 0))::numeric
  / NULLIF(impressions, 0)
) STORED
```
Note: `dislikes` and `saves` are not included in the rate calculation. `impressions` is the denominator, not `views`.

**Unique constraint:** `(profile_id, bundle_post_id, snapshot_date)` — one row per post per day (`0121:119`).

**Indexes** (`0121:122–129`):
1. `idx_social_post_analytics_profile_posted_at` on `(profile_id, posted_at DESC NULLS LAST)` — time-range queries
2. `idx_social_post_analytics_profile_platform_engagement` on `(profile_id, platform, engagement_rate DESC NULLS LAST)` — top-performers query
3. `idx_social_post_analytics_profile_snapshot_date` on `(profile_id, snapshot_date)` — daily aggregation

**RLS** (`0121:136–151`):
- `social_post_analytics_read`: SELECT for `is_opollo_staff() OR is_company_member(profile.company_id)` — company users can read their own.
- `social_post_analytics_staff_write`: ALL for `is_opollo_staff()` — only staff (service role) writes.

### 1.2 `social_profile_analytics_snapshots`

**Migration:** `supabase/migrations/0121_social_analytics_tables.sql` (lines 21–78)

**Purpose:** Daily per-account aggregate metrics (followers, impressions, views). Profile-level, not post-level.

**Notable columns:** `followers`, `following`, `post_count`, `impressions`, `impressions_unique`, `views`, `views_unique`, `likes`, `comments`, `period_kind` (rolling/lifetime/snapshot).

**Unique constraint:** `(profile_id, platform, bundle_social_account_id, snapshot_date)` (`0121:47`).

### 1.3 `social_post_analytics_cache`

**Migration:** `supabase/migrations/0134_analytics_cache.sql` (lines 16–41)

**Purpose:** Hot-cache for drafted post analytics (post-publish metrics retrieved for a specific draft). Linked to `social_post_drafts` not `social_post_analytics_snapshots`. Different data path — stores fetched-on-demand metrics per draft.

**Key columns:** `draft_id` (FK → `social_post_drafts`), `fetched_at`, `impressions`, `engagement_rate NUMERIC(5,2)`, `reactions`, `shares`, `comments`, `clicks`, `platform_specific JSONB`.

### 1.4 `cap_generation_runs`

**Migration:** `supabase/migrations/0137_cap_phase_1_schema.sql` (lines 311–349)

**Purpose:** Immutable audit trail for every Anthropic / Ideogram call in the CAP pipeline.

**`operation` column** (`0137:319–321`):
```sql
operation text NOT NULL
  CHECK (operation IN ('text_generation', 'image_generation', 'full_campaign'))
```

**Key columns:** `cap_campaign_post_id`, `cap_campaign_id`, `operation`, `prompt_version INT`, `prompt_used TEXT`, `model TEXT`, `input_tokens`, `output_tokens`, `estimated_cost_usd NUMERIC(10,6)`, `latency_ms`, `status` (success/error), `error_details JSONB`.

**No soft delete** — design intent is an immutable audit log.

### 1.5 `platform_companies.timezone`

`timezone TEXT NOT NULL DEFAULT 'Australia/Melbourne'` — `supabase/migrations/0070_platform_foundation.sql:201`. Exists; used for per-company timezone display.

### 1.6 Cron schedules

From `vercel.json`:

| Path | Schedule | Line |
|---|---|---|
| `/api/cron/social-analytics-refresh` | `0 4 * * *` (daily 04:00 UTC) | 108–109 |
| CAP monthly cron | `0 4 1 * *` (1st of month, 04:00 UTC) | 93 |

### 1.7 Tables NOT found

- No `ins_*` tables anywhere in migrations (checked with grep across all migration files).
- No `competitor_*` tables.

---

## §2 Analytics Surface

### 2.1 Company-facing analytics page: `/company/social/analytics`

**Page:** `app/(platform)/company/social/analytics/page.tsx`

**Data function:** `getSocialAnalytics()` — `lib/platform/social/analytics.ts:81`

**Queries (from `lib/platform/social/analytics.ts:93–157`):** All queries against `social_post_master`:
- Total published all-time (count)
- Published this calendar month (count)
- Upcoming scheduled (count)
- Active (healthy) connections count
- All posts by `source_type + state` (capped at 2,000 rows for chart)
- Published in last 30 days (trend chart)
- Pending approval (count)

**Not queried:** `social_post_analytics_snapshots`, `social_profile_analytics_snapshots`.

**Verdict: This page shows publishing throughput, not engagement metrics.** Impressions, likes, comments, shares, engagement rate are absent. This is the primary analytics gap for company users.

**Charts** (`components/SocialAnalyticsClient.tsx:6–17`): `AreaChart` (publish trend), two `BarChart` instances (by source type, by state), `PieChart` (distribution) — all from **Recharts** (`import from "recharts"` at line 17).

**Auth gate** (`app/(platform)/company/social/analytics/page.tsx:65`): `canDo(companyId, "view_calendar")` — viewer role or above.

### 2.2 Admin profile analytics page: `/admin/companies/[id]/social-profiles/[profileId]/analytics`

**Data function:** `getProfileAnalyticsDashboard()` — `lib/platform/social/analytics-ingest/dashboard.ts:79`

**Queries (`dashboard.ts:113, 130`):** Both query `social_post_analytics_snapshots` — engagement metrics (impressions, engagement_rate, top posts by rate, trend over time).

**Verdict: Engagement metrics exist here, but only Opollo staff can reach this route.** Company users have no path to this data.

### 2.3 Chart libraries in production

| File | Library | Components used |
|---|---|---|
| `components/SocialAnalyticsClient.tsx:17` | Recharts | `AreaChart`, `BarChart` (×2), `PieChart` |
| `components/analytics/ImpressionsTimeSeries.tsx:12` | Recharts | (timeseries chart) |

ECharts mandate is in docs only (`docs/architecture/DESIGN_SYSTEM.md` on branch `docs/mandate-echarts-only-charts`). Neither the ESLint guardrail nor the migration has merged.

---

## §3 Brief Assumption Verification

### 3.1 Is performance-priors wired up on main?

**`lib/cap/performance-priors.ts`:** **DOES NOT EXIST on main.** Verified by `ls lib/cap/performance-priors.ts` on this branch (returns not found).

**`lib/cap/generation/post-generator.ts` on main:** No import of `fetchPerformancePriors` or `formatPerformancePriorsBlock`. The `buildCampaignPostSystemMessage()` call at `post-generator.ts:69` passes no argument (confirmed by reading the file on this branch).

**`lib/cap/prompts/campaign-post.ts:20–31`:** `buildCampaignPostSystemMessage()` accepts an optional `performancePriorsBlock?: string` parameter (already added for the draft PR), but on main the callers pass no argument.

**Status:** Feature complete on `feat/cap-performance-priors` (draft PR #997), awaiting merge.

### 3.2 Cost cap enforcement

**Function:** `assertCostCapNotExceeded()` — `lib/cap/cost-cap.ts:25–72`

**Window:** 30-day rolling (`since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)`, line 39). Not a calendar month.

**Logic:** Sums `estimated_cost_usd` from `cap_generation_runs` for all campaigns owned by the subscription in the past 30 days. Compares against `cap_subscriptions.monthly_cost_cap_usd`. Throws `CostCapExceededError` if `spentUsd >= capUsd`.

**Called before generation** in:
- `lib/cap/generation/campaign-runner.ts:44` — full campaign run
- `lib/cap/generation/regenerate-post.ts:51` — individual post regen

**On threshold breach:** fires `recordHealthEvent()` with `serviceName: "cap"`, `eventType: "cost_cap_exceeded"`, `severity: "warning"` (`cost-cap.ts:63–69`).

### 3.3 CAP operator access gate

**Function:** `requireCapOperatorForApi()` — `lib/cap/api-gate.ts:18–32`

Uses `createRouteAuthClient()` (session cookie), calls `is_cap_operator()` Postgres RPC. Returns `{kind:"allow", userId}` or `{kind:"deny", response: NextResponse}`. All CAP API routes gate through this before any data access.

### 3.4 Post push to composer

**Function:** `pushCapPostToComposer()` — `lib/cap/push-to-composer.ts:11`

Writes a `social_post_drafts` row, then updates `cap_campaign_posts.social_draft_id` and sets status to `"pushed"` (`push-to-composer.ts:97`). This is the handoff from CAP to the social posting workflow.

### 3.5 CAP prompt versioning

`PROMPT_VERSION = 1` — `lib/cap/prompts/campaign-post.ts:3`. Version stored per generation run in `cap_generation_runs.prompt_version`.

### 3.6 CAP model

`DEFAULT_MODEL = "claude-sonnet-4-6"` — `lib/cap/generation/post-generator.ts:46`. Hardcoded; no env-var override path exists.

---

## §4 Bundle.social Integration

### 4.1 Analytics SDK surface

Functions used in the ingest path:

| SDK function | Purpose | Location |
|---|---|---|
| `analyticsGetSocialAccountAnalytics` | Account-level aggregate metrics | `lib/platform/social/analytics-ingest/refresh.ts` |
| `analyticsGetBulkPostAnalytics` | Post-level engagement metrics | `lib/platform/social/analytics-ingest/refresh.ts` |
| `postImportGetImportedPosts` | Post history import (for content capture) | `lib/platform/social/analytics-ingest/post-history-import.ts` |

### 4.2 X/Twitter: not supported

**Explicit non-coverage** (`lib/platform/social/analytics-ingest/platform-map.ts:9–13`):

> "X (Twitter): bundle.social's `analyticsGetSocialAccountAnalytics` and `postImportCreate` do NOT include TWITTER — X simply doesn't expose the analytics surface via their API. We return `null` for those calls and the analytics UI renders the platform card with a 'no analytics available' tooltip rather than a broken state."

`BundleSocialAnalyticsPlatform` type (`platform-map.ts:17–28`) includes: TIKTOK, YOUTUBE, INSTAGRAM, FACEBOOK, THREADS, REDDIT, PINTEREST, MASTODON, LINKEDIN, BLUESKY, GOOGLE_BUSINESS — no TWITTER.

This is a hard API limitation, not a code gap.

### 4.3 Post import platform coverage

`BundleSocialPostImportPlatform` (`platform-map.ts:30–34`): FACEBOOK, INSTAGRAM, THREADS, TIKTOK only. LinkedIn, YouTube, etc. do not support post history import via bundle.social.

### 4.4 Unused bundle.social capabilities

The following capabilities exist in the bundle.social SDK but are not consumed by this codebase (based on code search):

- Audience demographics (age, gender, geography breakdowns)
- Follower growth over time
- Hashtag performance
- Best-time-to-post recommendations
- Competitor tracking
- Direct messages
- Stories analytics

These are not present in any migration, route handler, or data function.

### 4.5 Google Business: analytics yes, import no

Per `platform-map.ts:15–16`: Google Business supports analytics but not post history import. This asymmetry is documented in the map.

---

## §5 CAP Integration

### 5.1 Generation pipeline

```
runCampaign(campaignId)                    [campaign-runner.ts:22]
  → assertCostCapNotExceeded()             [cost-cap.ts:25]
  → upsert 4 pending cap_campaign_posts    [campaign-runner.ts:65]
  → for each post:
      generatePost()                       [post-generator.ts:48]
        → fetchPerformancePriors()         [DRAFT PR #997 — NOT ON MAIN]
        → buildCampaignPostSystemMessage() [prompts/campaign-post.ts:20]
        → buildCampaignPostUserMessage()   [prompts/campaign-post.ts:47]
        → provider.generate() (Claude)     [cap/pal]
        → recordGenerationRun()            [post-generator.ts:180]
      generateImageForPost()               [image-orchestrator.ts]
      update cap_campaign_posts.status → "generated"
  → update cap_campaigns.status → "review"
```

### 5.2 Arc phases

Four fixed phases (`campaign-runner.ts:9–14`):

| weekNumber | arcPhase |
|---|---|
| 1 | awareness |
| 2 | education |
| 3 | offer |
| 4 | proof |

Guidance for each phase is hardcoded in `lib/cap/prompts/campaign-post.ts:5–18`. Not configurable per subscription.

### 5.3 Post content requirements

From `buildCampaignPostUserMessage()` (`prompts/campaign-post.ts:96–108`):
- 150–280 words
- No hashtags in body (returned separately as array)
- No em-dashes
- Blank line between paragraphs
- Responds with JSON `{content, hashtags}`

### 5.4 Idempotency

`cap_campaign_posts` has `UNIQUE (cap_campaign_id, week_number)` (`0137_cap_phase_1_schema.sql`). The upsert in `campaign-runner.ts:65–68` uses `onConflict: "cap_campaign_id,week_number"` — re-running a campaign does not duplicate posts.

### 5.5 Error handling

Per-post failures in `campaign-runner.ts:135–149`: sets that post's status to `"failed"`, sets the campaign status to `"failed"`, and rethrows — subsequent posts in the same campaign run do NOT execute. This is fail-fast, not partial-success behaviour.

---

## §6 Competitor Data

No competitor tracking capabilities exist in the codebase:

- No `competitor_*` tables in any migration file.
- No phantombuster, apify, brightdata, or similar third-party libraries in `package.json`.
- No competitor data in the bundle.social SDK surface used.
- No competitor routes in `app/` or `lib/`.

**Verdict:** Competitor analytics are not available and would require a new data source.

---

## §7 Security

### 7.1 RLS on analytics tables

| Table | RLS | Read policy | Write policy |
|---|---|---|---|
| `social_post_analytics_snapshots` | Enabled | `is_opollo_staff() OR is_company_member(profile.company_id)` | `is_opollo_staff()` only |
| `social_profile_analytics_snapshots` | Enabled | same pattern | staff-only |
| `social_post_analytics_cache` | Enabled | `is_company_member(draft.company_id)` | staff-only |
| `cap_generation_runs` | Enabled | service_role_all + staff_all | same |

Citations: `0121_social_analytics_tables.sql:136–151`, `0134_analytics_cache.sql:32–41`, `0137_cap_phase_1_schema.sql:342–350`.

### 7.2 CAP operator gate

`requireCapOperatorForApi()` (`lib/cap/api-gate.ts:18–32`) — all CAP routes require `is_cap_operator()` RPC to return `true`. Fails with 401 if no session, 403 if not an operator.

### 7.3 Cost cap as an economic security control

`assertCostCapNotExceeded()` (`lib/cap/cost-cap.ts:25`) is called before every generation. A compromised CAP operator account cannot run unlimited Anthropic calls beyond the subscription cap.

### 7.4 CAP tables lack soft delete

`cap_campaigns`, `cap_campaign_posts`, `cap_generation_runs` have no `deleted_at` column. This is intentional (immutable audit log design), but means records cannot be hidden from company users if RLS is misconfigured — hard deletes only.

### 7.5 Security headers

HSTS set to `max-age=63072000; includeSubDomains; preload` (`lib/security-headers.ts:78`).

---

## §8 Performance & Scale

### 8.1 Available index coverage for top-performers query

The performance-priors query pattern (sort by `engagement_rate DESC`, filter by `profile_id`, filter on `impressions >= 50`) is covered by:

```
idx_social_post_analytics_profile_platform_engagement
  ON social_post_analytics_snapshots(profile_id, platform, engagement_rate DESC NULLS LAST)
```
(`0121:125–126`). The `impressions` filter is not in this index; Postgres will use the index for the sort and filter `impressions` as a recheck. For small result sets (limit 20) this is efficient.

### 8.2 Query plans

**NOT AVAILABLE** — Docker not running; local Supabase cannot execute EXPLAIN ANALYZE. Query plan analysis requires a running instance with representative data.

### 8.3 Analytics cache table

`social_post_analytics_cache` (`0134`) uses an index on `(draft_id, fetched_at DESC)` for hot-path reads. There is no explicit TTL or eviction logic visible in the migration or code search; the cache grows until manually purged or cascade-deleted when the draft is deleted.

---

## §9 Observability

### 9.1 Structured logging

**Implementation:** `lib/logger.ts` — Axiom (fire-and-forget, long-retention) + console (JSON to stdout) transports.

**Axiom:** `lib/logger.ts:1,21–27`. Gated on `AXIOM_TOKEN` + `AXIOM_DATASET` env vars. Missing vars → console-only, no error.

**CAP log events (selected):**

| Event | Severity | Location |
|---|---|---|
| `cap.campaign-runner.start` | info | `campaign-runner.ts:52` |
| `cap.campaign-runner.post_generated` | info | `campaign-runner.ts:134` |
| `cap.campaign-runner.post_failed` | error | `campaign-runner.ts:136` |
| `cap.campaign-runner.complete` | info | `campaign-runner.ts:153` |
| `cap.post-generator.parse_failed` | warn | `post-generator.ts:145` |
| `cap.post-generator.run_record_failed` | warn | `post-generator.ts:197` |
| `cap.cost-cap.check` | info | `cost-cap.ts:60` |
| `cap.regenerate-post.reason` | info | `regenerate-post.ts:54` |
| `cap.regenerate-post.complete` | info | `regenerate-post.ts:111` |

### 9.2 LLM tracing

**Langfuse:** `lib/langfuse.ts` — wraps Anthropic calls. Gated on `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and `LANGFUSE_HOST` env vars. Lazy singleton; returns `null` when unconfigured (test-safe).

### 9.3 APM

**Sentry:** `sentry.server.config.ts:12` — `tracesSampleRate: 0.1` (10% of requests traced).

### 9.4 Service health events

`recordHealthEvent()` — `lib/platform/service-health/record.ts:20–64`. CAP uses:
- `serviceName: "cap"` — cost cap check breach (`cost-cap.ts:64`)
- `serviceName: "cap-cron"` — expected convention for cron health events (not verified in code; inferred from cost-cap.ts pattern)

### 9.5 Gaps

- No `ins.*` log namespace exists anywhere in the codebase (searched).
- No analytics ingest success/failure metrics emitted as structured log events — the refresh cron logs to console but does not emit a structured telemetry event that could trigger an alert.
- No circuit breaker on bundle.social API calls — if the API is down, retries run to exhaustion on each publish attempt before failing.

---

## Appendix: Schema diagram (key tables)

```
platform_social_profiles
  └─ id
  └─ company_id → platform_companies

social_post_analytics_snapshots (0121)
  └─ profile_id → platform_social_profiles
  └─ bundle_post_id (bundle.social post id)
  └─ engagement_rate STORED GENERATED

social_profile_analytics_snapshots (0121)
  └─ profile_id → platform_social_profiles

social_post_analytics_cache (0134)
  └─ draft_id → social_post_drafts

cap_subscriptions (0137)
  └─ company_id → platform_companies
  └─ monthly_cost_cap_usd

cap_campaigns (0137)
  └─ cap_subscription_id → cap_subscriptions
  └─ voice_profile_id → cap_voice_profiles

cap_campaign_posts (0137)
  └─ cap_campaign_id → cap_campaigns
  └─ social_draft_id → social_post_drafts (post-merge push)

cap_generation_runs (0137)
  └─ cap_campaign_post_id → cap_campaign_posts
  └─ cap_campaign_id → cap_campaigns
  └─ operation: text_generation | image_generation | full_campaign
```

---

*Audit conducted 2026-05-23. Research-only — no application code, migrations, or configs were modified.*
