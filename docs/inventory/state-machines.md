# State Machines Inventory

All state machines in the Opollo Site Builder codebase.
Each entity has a canonical DB constraint (the CHECK in the migration) and, where one exists,
a TypeScript source-of-truth file.

"EXPECTED BEHAVIOUR" sections are intentionally left as empty checkboxes for Steven to fill in.

---

## 1. social_post_drafts — social_post_drafts.state

**Table:** `social_post_drafts`
**State column:** `state`
**DB constraint:** `CHECK (state IN ('draft','pending_approval','rejected','scheduled','recurring','paused','publishing','published','failed'))` — migration `0132_planned_for_at.sql`
**TypeScript source of truth:** `lib/social/post-state-actions.ts`

### States

| State | Meaning | Terminal? |
|---|---|---|
| `draft` | Post is being composed; not yet submitted or scheduled | No |
| `pending_approval` | Submitted for approval; awaiting an approver action | No |
| `rejected` | Approver rejected the post; can be edited and resubmitted | No |
| `scheduled` | Scheduled for future publish at a specific datetime | No |
| `recurring` | Part of a recurring publish schedule | No |
| `paused` | Recurring schedule has been paused | No |
| `publishing` | Publish job has claimed the post and is in-flight; no mutations allowed | Effectively yes — mutations gated off |
| `published` | Successfully published to the external platform | Yes |
| `failed` | Publish attempt failed; can be retried | No |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| `draft` → `scheduled` | PATCH `mode=schedule` | `app/api/platform/social/drafts/[id]/route.ts` |
| `draft` → `pending_approval` | POST to submit-for-approval endpoint | `app/api/platform/social/drafts/[id]/submit-for-approval/route.ts` |
| `pending_approval` → `approved` (→ `scheduled`) | POST to approve endpoint | `app/api/platform/social/drafts/[id]/approve/route.ts` |
| `pending_approval` → `rejected` | POST to reject endpoint | `app/api/platform/social/drafts/[id]/approve/route.ts` |
| `scheduled` → `draft` | POST to convert-to-draft endpoint | `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` |
| `recurring` → `draft` | POST to convert-to-draft endpoint | `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` |
| `paused` → `draft` | POST to convert-to-draft endpoint | `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` |
| `scheduled` → `publishing` | Cron job claims due posts | `app/api/internal/cron/publish-due/route.ts` |
| `publishing` → `published` | Publish job completes successfully | `app/api/platform/social/drafts/[id]/publish/route.ts` |
| `publishing` → `failed` | Publish job encounters an error | `app/api/platform/social/drafts/[id]/publish/route.ts` |
| `failed` → `scheduled` | Retry action (PATCH `mode=schedule`) | `app/api/platform/social/drafts/[id]/route.ts` |

### Allowed actions per state (from `lib/social/post-state-actions.ts:48-64`)

| State | Allowed actions |
|---|---|
| `draft` | `edit`, `schedule`, `save_draft`, `delete` |
| `pending_approval` | `view`, `approve`, `reject`, `delete` |
| `rejected` | `edit`, `save_draft`, `delete` |
| `scheduled` | `edit`, `reschedule`, `convert_to_draft`, `delete` |
| `recurring` | `view`, `convert_to_draft`, `delete` |
| `paused` | `view`, `convert_to_draft`, `delete` |
| `publishing` | `view` only |
| `published` | `view`, `view_on_platform`, `view_analytics`, `repost_as_new`, `delete_from_records` |
| `failed` | `edit`, `retry_publish`, `save_draft`, `delete` |

### UI surfaces rendering this entity

- `/company/[id]/social/*` — `components/social/composer/ComposerOverlay.tsx` — renders textarea as read-only when `isReadOnlyState(state)` is true (all states without `edit` action)
- `/company/[id]/social/*` — `components/social/composer/PostInfoCard.tsx` — state-aware action buttons
- `/company/[id]/social/calendar` — `components/social/CalendarShell.tsx` — posts rendered per scheduled datetime

### Known transition guards

- `isTerminalForMutation(state)` returns true for `published` and `publishing`; PATCH endpoint returns 422 for these states (`lib/social/post-state-actions.ts:81-83`)
- Server-side PATCH endpoint checks `isTerminalForMutation` before applying any field update (`app/api/platform/social/drafts/[id]/route.ts`)
- `delete_from_records` removes only the Opollo DB row — it does NOT unpublish from the external platform (note in `lib/social/post-state-actions.ts:11-14`)

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state (badge colour, read-only styling)?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 2. social_connections — social_connections.status

**Table:** `social_connections`
**State column:** `status`
**DB constraint:** `ENUM ('healthy','degraded','auth_required','disconnected')` — migration `0070_platform_foundation.sql` line 143
**DB type:** `social_connection_status` (Postgres ENUM, not CHECK)

### States

| State | Meaning | Terminal? |
|---|---|---|
| `healthy` | Connection is authenticated and operating normally | No |
| `degraded` | Connection is authenticated but experiencing errors or rate-limits | No |
| `auth_required` | OAuth token has expired or been revoked; re-auth needed | No |
| `disconnected` | Connection has been explicitly disconnected by the operator | Yes (operator-initiated) |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| any → `disconnected` | POST to disconnect endpoint | `app/api/platform/social/connections/[id]/disconnect/route.ts` |
| `auth_required` → `healthy` | POST to reconnect endpoint (re-OAuth) | `app/api/platform/social/connections/reconnect/route.ts` |
| `healthy` / `degraded` → `auth_required` | Health cron detects token failure | `app/api/cron/social-connections-health/route.ts` |
| `degraded` → `healthy` | Health cron detects recovery | `app/api/cron/social-connections-health/route.ts` |
| `healthy` → `degraded` | Health cron detects partial errors | `app/api/cron/social-connections-health/route.ts` |

### UI surfaces rendering this entity

- `/company/[id]/social/connections` — `components/social/dashboard/AddProfileDropdown.tsx` — displays connection status badge; surfaces re-auth CTA when `auth_required`

### Known transition guards

- Disconnect endpoint removes the bundle.social connection server-side; status update is the last write
- Health cron is the only process that sets `degraded` or `auth_required` automatically

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state (badge colour)?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 3. generation_jobs — generation_jobs.status

**Table:** `generation_jobs`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('queued','running','partial','succeeded','failed','cancelled'))` — migration `0007_m3_1_batch_schema.sql` line 68

### States

| State | Meaning | Terminal? |
|---|---|---|
| `queued` | Job submitted; no worker has started yet | No |
| `running` | Worker is actively processing pages | No |
| `partial` | Job finished but some pages failed; `failed_count > 0` | Yes (but reviewable) |
| `succeeded` | All pages generated successfully | Yes |
| `failed` | Job failed; no pages succeeded | Yes |
| `cancelled` | Operator cancelled before completion | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `queued` | POST create batch job | `app/api/admin/batch/route.ts` |
| `queued` → `running` | Worker picks up job | `app/api/cron/process-batch/route.ts` |
| `running` → `succeeded` | All pages complete | `app/api/cron/process-batch/route.ts` |
| `running` → `partial` | Job ends with some failures | `app/api/cron/process-batch/route.ts` |
| `running` → `failed` | Job ends with all failures | `app/api/cron/process-batch/route.ts` |
| `queued` / `running` → `cancelled` | POST cancel endpoint | `app/api/admin/batch/[id]/cancel/route.ts` |

### UI surfaces rendering this entity

- `/admin/batch` — batch list page — shows job status and progress
- `/admin/batch/[id]` — job detail page — shows per-page slot progress

### Known transition guards

- `cancel_requested_at` timestamp is set by the cancel endpoint; the worker polls it to abort cleanly
- Idempotency key + body hash pair provides Stripe-style replay semantics on POST

## 3b. generation_job_pages — generation_job_pages.state

**Table:** `generation_job_pages`
**State column:** `state`
**DB constraint:** `CHECK (state IN ('pending','leased','generating','validating','publishing','succeeded','failed','skipped'))` — migration `0007_m3_1_batch_schema.sql` line 140

### States

| State | Meaning | Terminal? |
|---|---|---|
| `pending` | Slot waiting to be leased by a worker | No |
| `leased` | Worker has claimed the slot via `FOR UPDATE SKIP LOCKED` | No |
| `generating` | Worker is calling Anthropic to generate content | No |
| `validating` | Worker is validating generated content | No |
| `publishing` | Worker is pushing generated page to WordPress | No |
| `succeeded` | Page generated and published successfully | Yes |
| `failed` | Slot failed; eligible for retry up to the configured ceiling | Yes |
| `skipped` | Slot intentionally skipped (e.g. slug conflict) | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| `pending` → `leased` | Worker dequeue (`FOR UPDATE SKIP LOCKED`) | `app/api/cron/process-batch/route.ts` |
| `leased` → `generating` | Worker begins Anthropic call | `app/api/cron/process-batch/route.ts` |
| `generating` → `validating` | Anthropic response received | `app/api/cron/process-batch/route.ts` |
| `validating` → `publishing` | Validation passes | `app/api/cron/process-batch/route.ts` |
| `publishing` → `succeeded` | WordPress publish confirmed | `app/api/cron/process-batch/route.ts` |
| any non-terminal → `failed` | Error at any worker step | `app/api/cron/process-batch/route.ts` |
| any non-terminal → `skipped` | Slug conflict or other non-retryable skip | `app/api/cron/process-batch/route.ts` |

### Known transition guards

- `lease_expires_at` + `worker_id` drive the `FOR UPDATE SKIP LOCKED` dequeue; a stale lease is re-claimable after expiry
- `anthropic_idempotency_key` / `wp_idempotency_key` are pre-computed on insert for stable retry semantics
- `generation_events` is an append-only audit log written BEFORE the slot-column update so billing is reconstructible on failure

### EXPECTED BEHAVIOUR (Steven to fill — applies to both generation_jobs and generation_job_pages)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 4. opt_proposals — opt_proposals.status

**Table:** `opt_proposals`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('draft','pending','approved','applying','applied','applied_promoted','applied_then_reverted','applied_then_failed','rejected','expired'))` — migration `0053_optimiser_brief_submission.sql`
**Comment:** `draft → pending → approved → applying → applied → applied_promoted | applied_then_reverted | applied_then_failed; OR pending → rejected | expired`

### States

| State | Meaning | Terminal? |
|---|---|---|
| `draft` | Proposal being authored; not yet submitted | No |
| `pending` | Submitted to client for approval | No |
| `approved` | Client approved; queued for application | No |
| `applying` | Brief runner is applying the proposal's changes to the page | No |
| `applied` | Changes applied; live on the landing page | No |
| `applied_promoted` | Applied and then promoted from a staged rollout | Yes |
| `applied_then_reverted` | Applied but subsequently rolled back | Yes |
| `applied_then_failed` | Applying process succeeded but downstream error occurred | Yes |
| `rejected` | Client explicitly rejected the proposal | Yes |
| `expired` | Proposal passed its approval window without action | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `draft` | Proposal creation | `app/api/optimiser/proposals/route.ts` |
| `draft` → `pending` | Submit for approval | `app/api/optimiser/proposals/[id]/route.ts` |
| `pending` → `approved` | Client approves | `app/api/optimiser/proposals/[id]/approve/route.ts` |
| `pending` → `rejected` | Client rejects | `app/api/optimiser/proposals/[id]/reject/route.ts` |
| `pending` → `expired` | Expiry cron fires | `app/api/cron/optimiser-expire-proposals/route.ts` |
| `approved` → `applying` | Brief runner begins application | triggered by brief runner |
| `applying` → `applied` | Changes successfully applied | brief runner completion |
| `applying` → `applied_then_failed` | Application process failed | brief runner error path |
| `applied` → `applied_promoted` | Staged rollout promotes the variant | `app/api/optimiser/proposals/[id]/rollback/route.ts` (or staged rollout monitor) |
| `applied` → `applied_then_reverted` | Rollback triggered | `app/api/optimiser/proposals/[id]/rollback/route.ts` |

### UI surfaces rendering this entity

- Optimiser module proposal list — shows proposal status badge
- Proposal detail page — shows approve/reject CTAs when `pending`
- Rollback CTA shown when `applied` or `applied_promoted`

### Known transition guards

- Approve endpoint only acts on `pending` proposals; returns error for other states
- Reject endpoint only acts on `pending` proposals
- Rollback endpoint only acts on `applied` or `applied_promoted` proposals
- Expiry cron only transitions `pending` proposals past their `expires_at`

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 5. opt_landing_pages — opt_landing_pages.state

**Table:** `opt_landing_pages`
**State column:** `state`
**DB constraint:** `CHECK (state IN ('active','healthy','insufficient_data','read_only_external'))` — migration `0037_optimiser_landing_pages.sql` line 52
**Default:** `insufficient_data`

### States

| State | Meaning | Terminal? |
|---|---|---|
| `insufficient_data` | Page exists but not enough metrics to evaluate | No |
| `active` | Page is being actively optimised; enough data to run proposals | No |
| `healthy` | Page is meeting performance targets; no active optimisation needed | No |
| `read_only_external` | Page is externally managed (`management_mode = 'read_only'`) or page link was severed (`page_id = NULL` with `full_automation`) | No |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| `insufficient_data` → `active` | Daily metrics aggregation determines sufficient data | metrics aggregator / evaluator cron |
| `active` → `healthy` | Evaluator determines performance targets met | metrics evaluator cron |
| `healthy` → `active` | Performance regresses below targets | metrics evaluator cron |
| `active` / `healthy` → `insufficient_data` | Data window drops below threshold | metrics evaluator cron |
| any → `read_only_external` | `page_id` set to NULL with `full_automation` mode, or `management_mode` changed to `read_only` | application logic |

### UI surfaces rendering this entity

- Optimiser landing page browser — state used to sort and filter pages
- Per-page detail — state badge shown; read-only warning shown for `read_only_external`

### Known transition guards

- `state_evaluated_at` and `state_reasons` JSONB column record what drove the last evaluation
- `data_reliability` column (`green` / `amber` / `red`) is a separate signal refreshed alongside state
- Coherence check: `NULL page_id` with `full_automation` is semantically `read_only_external` per migration comment

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 6. opt_staged_rollouts — opt_staged_rollouts.current_state

**Table:** `opt_staged_rollouts`
**State column:** `current_state`
**DB constraint:** `CHECK (current_state IN ('live','auto_reverted','promoted','manually_promoted','failed'))` — migration `0054_optimiser_staged_rollouts.sql` line 46
**Default:** `live`
**Coherence constraint:** `live` requires `ended_at IS NULL AND end_reason IS NULL`; all other states require both to be set

### States

| State | Meaning | Terminal? |
|---|---|---|
| `live` | Rollout is active; variant is receiving traffic at `traffic_split_percent` | No |
| `auto_reverted` | Monitor detected a regression and automatically reverted the variant | Yes |
| `promoted` | Monitor determined the variant met promotion criteria; variant is now canonical | Yes |
| `manually_promoted` | Operator manually promoted the variant outside of automatic criteria | Yes |
| `failed` | Rollout itself encountered an error (not a regression; infrastructure failure) | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `live` | Proposal `applied` triggers rollout creation | brief runner / proposal apply path |
| `live` → `auto_reverted` | Monitor cron detects CR drop or bounce regression | `app/api/cron/optimiser-expire-proposals/route.ts` or dedicated monitor cron |
| `live` → `promoted` | Monitor cron: floors met, promotion criteria satisfied | monitor cron |
| `live` → `manually_promoted` | Operator manually promotes via UI | `app/api/optimiser/proposals/[id]/rollback/route.ts` or promote endpoint |
| `live` → `failed` | Infrastructure error in monitor evaluation | monitor cron error path |

### UI surfaces rendering this entity

- Optimiser proposal detail — rollout status shown alongside proposal status
- Rollout monitor dashboard (if exists)

### Known transition guards

- `regression_check_results` JSONB is append-only; each monitor evaluation appends a row before any state update
- `ended_at` + `end_reason` + `ended_by` must all be set when transitioning out of `live` (DB coherence CHECK)
- `end_reason` examples from migration comment: `cr_drop_15pct`, `floors_met_promote`, `window_expired`

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 7. cap_subscriptions — cap_subscriptions.status

**Table:** `cap_subscriptions`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('trial','active','paused','cancelled'))` — migration `0137_cap_phase_1_schema.sql` line 78
**Related column:** `tier` (`starter` / `growth` / `agency`) is orthogonal to status; `trial_ends_at` and `cancelled_at` are timestamps for terminal states

### States

| State | Meaning | Terminal? |
|---|---|---|
| `trial` | Subscription is in trial period; subject to `trial_ends_at` | No |
| `active` | Subscription is live and billing-eligible | No |
| `paused` | Subscription temporarily suspended by operator or system | No |
| `cancelled` | Subscription cancelled; `cancelled_at` is set | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `trial` | CAP subscription creation | CAP subscription create endpoint |
| `trial` → `active` | Trial period ends or operator upgrades | CAP admin action |
| `active` → `paused` | Operator pauses subscription | CAP admin endpoint |
| `paused` → `active` | Operator resumes subscription | CAP admin endpoint |
| any → `cancelled` | Operator cancels; sets `cancelled_at` | CAP admin endpoint |

### UI surfaces rendering this entity

- `/admin/companies/[id]` — CAP subscription status badge
- CAP operator dashboard — subscription list with status filter

### Known transition guards

- `monthly_cost_cap_usd` limits AI spend per billing cycle regardless of status
- `approval_required` flag controls whether campaign posts require explicit approval before push

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 8a. cap_campaigns — cap_campaigns.status

**Table:** `cap_campaigns`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('draft','generating','review','approved','pushed','published','archived','failed'))` — migration `0137_cap_phase_1_schema.sql` line 198
**Uniqueness:** `UNIQUE (cap_subscription_id, month)` — one campaign per subscription per month

### States

| State | Meaning | Terminal? |
|---|---|---|
| `draft` | Campaign for the month is being set up | No |
| `generating` | AI is generating the 4 post contents for this campaign | No |
| `review` | Generated content is ready for operator/client review | No |
| `approved` | All posts approved; ready to be pushed to social drafts | No |
| `pushed` | All posts pushed as `social_post_drafts` rows | No |
| `published` | All posts have published successfully on social platforms | Yes |
| `archived` | Campaign archived (past month, operator action) | Yes |
| `failed` | Generation or push step failed | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `draft` | Monthly campaign creation (manual or cron) | CAP campaign create logic |
| `draft` → `generating` | Generation triggered | CAP generation run |
| `generating` → `review` | All 4 posts generated | generation completion |
| `review` → `approved` | Operator/client approves all posts | CAP approve endpoint |
| `approved` → `pushed` | Posts pushed to `social_post_drafts` | CAP push endpoint |
| `pushed` → `published` | All linked `social_post_drafts` reach `published` | post-publish hook or cron |
| any → `failed` | Error in generation or push | CAP error path |
| any terminal → `archived` | Operator archives | CAP archive endpoint |

### UI surfaces rendering this entity

- CAP dashboard — monthly campaign card with status badge
- Campaign detail — per-post review interface

### Known transition guards

- `UNIQUE (cap_subscription_id, month)` prevents duplicate campaigns per month
- `cap_generation_runs` table (also in 0137) tracks individual generation run attempts

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 8b. cap_campaign_posts — cap_campaign_posts.status

**Table:** `cap_campaign_posts`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('pending','generated','approved','rejected','pushed','published','failed','approved_past_due'))` — migration `0137_cap_phase_1_schema.sql` line 261
**Related column:** `social_draft_id` (FK to `social_post_drafts.id`) — set when post is pushed
**Uniqueness:** `UNIQUE (cap_campaign_id, week_number)` — one post per week per campaign

### States

| State | Meaning | Terminal? |
|---|---|---|
| `pending` | Slot exists; AI generation not yet started for this post | No |
| `generated` | AI has produced content; awaiting review | No |
| `approved` | Content approved; awaiting push to social drafts | No |
| `rejected` | Content rejected; `rejection_reason` set; can be regenerated | No |
| `pushed` | Linked `social_post_drafts` row created (`social_draft_id` set) | No |
| `published` | Linked social post reached `published` state | Yes |
| `failed` | Generation or push failed | No (retryable) |
| `approved_past_due` | Approved after the optimal posting window passed | No |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `pending` | Campaign post row created | campaign creation |
| `pending` → `generated` | AI generates content for this slot | CAP generation run |
| `generated` → `approved` | Operator/client approves this post | CAP approve-post endpoint |
| `generated` → `rejected` | Operator/client rejects; sets `rejection_reason` | CAP reject-post endpoint |
| `rejected` → `generated` | Operator triggers regeneration; increments `regenerate_count` | CAP regenerate endpoint |
| `approved` → `pushed` | Post pushed to `social_post_drafts`; `social_draft_id` set | CAP push endpoint |
| `approved` → `approved_past_due` | Time passes optimal posting window | cron or application logic |
| `pushed` → `published` | Linked social post publishes | post-publish hook / cron sync |
| any → `failed` | Error during generation or push | CAP error path |

### UI surfaces rendering this entity

- CAP campaign detail — 4 week slots with per-post status and content preview
- Approve/reject/regenerate CTAs shown per post based on status

### Known transition guards

- `regenerate_count` is incremented on each regeneration; application may cap regenerations
- `social_draft_id` FK links to `social_post_drafts`; the social post's own state machine drives `pushed` → `published`
- `arc_phase` (`awareness` / `education` / `offer` / `proof`) is fixed at creation; does not change with status

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 9. briefs — briefs.status

**Table:** `briefs`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('parsing','parsed','committed','failed_parse'))` — migration `0013_m12_1_briefs_schema.sql` line 71

### States

| State | Meaning | Terminal? |
|---|---|---|
| `parsing` | Brief file has been uploaded; background parser is extracting structure | No |
| `parsed` | Parser succeeded; brief is ready to be run or committed | No |
| `committed` | Brief has been committed and applied to a site | Yes |
| `failed_parse` | Parser could not extract a valid brief from the uploaded file | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `parsing` | Brief upload / creation | `app/api/briefs/route.ts` |
| `parsing` → `parsed` | Parse job completes successfully | `app/api/cron/process-brief-runner/route.ts` |
| `parsing` → `failed_parse` | Parse job fails | `app/api/cron/process-brief-runner/route.ts` |
| `parsed` → `committed` | Operator commits the brief to a site | `app/api/briefs/[brief_id]/commit/route.ts` |

### UI surfaces rendering this entity

- `/admin/sites/[id]/briefs` — brief list with status badge
- Brief detail page — shows parse results when `parsed`; error detail when `failed_parse`

### Known transition guards

- A brief can only be run (`brief_runners` created) when it is in `parsed` state
- `committed` briefs are immutable — no further mutations via the composer

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 10. brief_runners — brief_runners.status

**Table:** `brief_runners`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('queued','running','paused','succeeded','failed','cancelled'))` — migration `0013_m12_1_briefs_schema.sql` line 197

### States

| State | Meaning | Terminal? |
|---|---|---|
| `queued` | Runner created; waiting for the cron worker to pick it up | No |
| `running` | Cron worker is actively processing the brief | No |
| `paused` | Execution paused by operator | No |
| `succeeded` | Brief runner completed successfully | Yes |
| `failed` | Runner encountered an unrecoverable error | Yes |
| `cancelled` | Operator cancelled before completion | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `queued` | Brief run triggered by operator or proposal approval | `app/api/briefs/[brief_id]/run/route.ts` |
| `queued` → `running` | Cron worker picks up the runner | `app/api/cron/process-brief-runner/route.ts` |
| `running` → `succeeded` | All brief steps complete | `app/api/cron/process-brief-runner/route.ts` |
| `running` → `failed` | Unrecoverable error | `app/api/cron/process-brief-runner/route.ts` |
| `running` → `paused` | Operator pauses | `app/api/briefs/[brief_id]/cancel/route.ts` or pause endpoint |
| `paused` → `running` | Operator resumes | resume endpoint |
| `queued` / `running` / `paused` → `cancelled` | Operator cancels | `app/api/briefs/[brief_id]/cancel/route.ts` |

### UI surfaces rendering this entity

- Brief detail page — runner status and progress
- Site brief list — shows latest runner status per brief

### Known transition guards

- Brief runners triggered by `opt_proposals` approval have `triggered_by_proposal_id` set (migration `0053`)
- The cron hot path is `app/api/cron/process-brief-runner` (listed in CLAUDE.md critical paths)

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 11. design_systems — design_systems.status

**Table:** `design_systems`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('draft','active','archived'))` — migration `0002_m1a_design_system_schema.sql` line 73

### States

| State | Meaning | Terminal? |
|---|---|---|
| `draft` | Design system being configured; not yet deployed to any site | No |
| `active` | Design system is live and assigned to one or more sites | No |
| `archived` | Design system retired; no longer assignable to new sites | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `draft` | Design system creation | design system create endpoint |
| `draft` → `active` | Design system activated / deployed | design system activate endpoint |
| `active` → `archived` | Admin archives the design system | design system archive endpoint |
| `draft` → `archived` | Admin discards a draft | design system archive endpoint |

### UI surfaces rendering this entity

- `/admin/design-systems` — list with status filter
- Site editor — only `active` design systems are assignable to sites

### Known transition guards

- Sites reference design systems by `design_system_version` text field; archiving does not break existing site assignments
- `archived` systems cannot be assigned to new sites (application guard)

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 12. sites — sites.status

**Table:** `sites`
**State column:** `status`
**DB type:** `site_status` (Postgres ENUM: `pending_pairing`, `active`, `paused`, `removed`) — migration `0001_initial_schema.sql` line 29
**Default:** `pending_pairing`
**Comment (migration 0056):** `Lifecycle: pending_pairing (no credentials yet) → active (paired + recent successful operation) → paused (operator suspended) → removed (soft-delete; prefix is freed for reuse).`

### States

| State | Meaning | Terminal? |
|---|---|---|
| `pending_pairing` | Site created but WordPress credentials not yet provided or verified | No |
| `active` | Site is paired and operating; has had at least one successful operation | No |
| `paused` | Site suspended by operator; no operations run | No |
| `removed` | Soft-deleted; prefix is freed for reuse by the partial unique index | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `pending_pairing` | Site creation | `app/api/admin/sites/route.ts` |
| `pending_pairing` → `active` | Successful connection test or first operation completes | `app/api/admin/sites/[id]/test-connection/route.ts` |
| `active` → `paused` | Operator suspends site | `app/api/admin/sites/[id]/route.ts` (PATCH) |
| `paused` → `active` | Operator resumes site | `app/api/admin/sites/[id]/route.ts` (PATCH) |
| any non-removed → `removed` | Operator soft-deletes site | `app/api/admin/sites/[id]/route.ts` (DELETE or PATCH) |

### UI surfaces rendering this entity

- `/admin/sites` — `app/(platform)/admin/sites/page.tsx` — site list with status filter; status badge per row
- `/admin/sites/[id]` — site detail — shows pairing instructions when `pending_pairing`; pause/resume CTA when `active` / `paused`

### Known transition guards

- `removed` sites are excluded from the `sites_prefix_active_uniq` partial unique index, freeing the prefix for reuse
- Soft-delete only — `ON DELETE RESTRICT` on downstream history tables prevents hard deletion
- `last_successful_operation_at` is updated by `app/api/admin/sites/[id]/test-connection/route.ts` on success (`0106_sites_last_connection_test_at.sql`)

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 13a. invites — invites.status

**Table:** `invites`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('pending','accepted','expired','revoked'))` — migration `0063_auth_foundation_roles_and_invites.sql` line 200
**Default:** `pending`
**Uniqueness:** `UNIQUE INDEX invites_pending_email_uniq ON invites (email) WHERE status = 'pending'` — at most one pending invite per email at a time

### States

| State | Meaning | Terminal? |
|---|---|---|
| `pending` | Invite email sent; token valid for 24 hours | No |
| `accepted` | Invitee clicked the link and completed signup; `accepted_at` set | Yes |
| `expired` | 24-hour window elapsed without acceptance | Yes |
| `revoked` | Admin explicitly cancelled the invite before it was accepted | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `pending` | Admin sends invite | `app/api/auth/invite/route.ts` |
| `pending` → `accepted` | Invitee accepts via `/api/auth/accept-invite` | `app/api/auth/accept-invite/route.ts` |
| `pending` → `expired` | Expiry cron or inline check on `expires_at` | background job or inline check |
| `pending` → `revoked` | Admin revokes invite | `app/api/auth/invite/[id]/revoke/route.ts` |

### UI surfaces rendering this entity

- Admin user management — pending invites list with revoke CTA
- Accept invite page — validates token and `pending` status before allowing signup

### Known transition guards

- `token_hash` is SHA-256 of a 32-byte random; raw token only ever in the email (never stored plain)
- Accept-invite endpoint validates `status = 'pending'` AND `expires_at > now()` before proceeding
- Partial unique index prevents issuing a second invite to an email that already has a `pending` one

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?

---

## 13b. platform_event_deliveries — platform_event_deliveries.status

**Table:** `platform_event_deliveries`
**State column:** `status`
**DB constraint:** `CHECK (status IN ('pending','in_flight','delivered','failed','dead_lettered'))` — migration `0126_reliability_and_cap_foundations.sql` line 211
**Default:** `pending`
**Comment (migration 0126):** `Status machine: pending → in_flight → delivered|failed|dead_lettered.`

> Note: The brief referenced "platform_invitations" for `in_flight` / `dead_lettered` states but those belong to `platform_event_deliveries` (the webhook/event fan-out delivery table). The actual `invites` table is documented as Entity 13a above.

### States

| State | Meaning | Terminal? |
|---|---|---|
| `pending` | Event enqueued for delivery to a subscription endpoint; not yet attempted | No |
| `in_flight` | Delivery worker has claimed this row and is making the HTTP call | No |
| `delivered` | HTTP call succeeded; endpoint acknowledged the event | Yes |
| `failed` | HTTP call failed; will be retried until `dead_lettered` | No |
| `dead_lettered` | Maximum retry attempts exhausted; delivery permanently failed | Yes |

### Transitions

| From → To | Trigger | File |
|---|---|---|
| (new) → `pending` | `fan_out_event_to_subscriptions` trigger on `platform_events` INSERT | DB trigger — migration `0126` |
| `pending` → `in_flight` | Delivery worker claims row | delivery worker cron |
| `in_flight` → `delivered` | Endpoint returns 2xx | delivery worker |
| `in_flight` → `failed` | Endpoint returns non-2xx or times out | delivery worker |
| `failed` → `in_flight` | Retry after `next_attempt_at` delay | delivery worker |
| `failed` → `dead_lettered` | `attempt_count` exceeds retry ceiling; `dead_lettered_at` set | delivery worker |

### UI surfaces rendering this entity

- Admin event log / observability dashboard (if exists)
- `dead_lettered` events may surface as alerts in service health

### Known transition guards

- `UNIQUE (subscription_id, event_id)` prevents duplicate delivery rows per (subscription, event) pair; `ON CONFLICT DO NOTHING` in the fan-out trigger defends against replication-lag double-fires
- `claimed_until` drives the `in_flight` index; stale in-flight rows (past `claimed_until`) are re-claimable
- `last_response_status` and `last_response_body` are stored for debugging
- The `publish_dead_lettered` and `campaign_post_dead_lettered` event types in `service_health_events` are raised when deliveries dead-letter (migration `0126` line 329 / 351)

### EXPECTED BEHAVIOUR (Steven to fill)

- [ ] For each state, what actions are allowed in the UI?
- [ ] For each state, what server-side mutations are allowed?
- [ ] What happens on an invalid transition attempt?
- [ ] What is the visual treatment per state?
- [ ] What notification (email/toast/banner) fires on state change?
- [ ] Is state-change audit-logged?
