# State Machines Inventory

> Generated: 2026-05-25.
> Covers every entity with a meaningful state column discovered in the codebase.
> EXPECTED BEHAVIOUR checkboxes are intentionally empty — Steven to fill.
> TypeScript types and migration references are cited where verified.

---

## social_post_drafts

**Table:** `social_post_drafts`
**State column:** `state` TEXT
**TypeScript type:** `DraftState` in `lib/social/types.ts:19-28`
**Migration:** `0132_planned_for_at.sql` (CHECK constraint added; `0131_recurring_drafts.sql` added `recurrence_state`)

**States:**

| State | Meaning |
|-------|---------|
| `draft` | Created, not yet submitted for approval or scheduled. Editable. |
| `pending_approval` | Submitted for approval; awaiting a decision from the named approver. Read-only to author. |
| `rejected` | Approval request was rejected. Author may edit and re-submit. |
| `scheduled` | Approved (or no-approval flow); `scheduled_at` is set; will be picked up by cron. |
| `recurring` | Parent recurring draft with no single `scheduled_at`; child instances are created per recurrence. |
| `paused` | Recurring series paused by user; no new child instances created. |
| `publishing` | Cron picked up and submitted to bundle.social; in-flight. |
| `published` | Successfully published via bundle.social. Terminal for one-off drafts. |
| `failed` | Publish attempt failed; `last_publish_error` is populated. Retryable. |

**Recurrence column:** `recurrence_state` TEXT (separate column, added `0131_recurring_drafts.sql`)

| Recurrence state | Meaning |
|-----------------|---------|
| `active` | Series is generating and publishing child instances |
| `paused` | Series suspended; no new instances |
| `ended` | Series completed all recurrences |
| `NULL` | Not a recurring draft |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| `draft` | `pending_approval` | Create with `approval_required=true` and `mode=schedule` | `app/api/platform/social/drafts/route.ts` (POST) |
| `draft` | `scheduled` | Create with `approval_required=false` and `mode=schedule` | `app/api/platform/social/drafts/route.ts` (POST) |
| `draft` | `recurring` | Create with `mode=recurring` and `approval_required=false` | `app/api/platform/social/drafts/route.ts` (POST) |
| `draft` | `pending_approval` | PATCH to submit existing draft for approval | `app/api/platform/social/drafts/[id]/route.ts` (PATCH) |
| `pending_approval` | `scheduled` | Approver decision = `approved` | `app/api/platform/social/drafts/[id]/approve/route.ts` |
| `pending_approval` | `rejected` | Approver decision = `rejected` | `app/api/platform/social/drafts/[id]/approve/route.ts` |
| `rejected` | `draft` | Author converts back | `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` |
| `scheduled` | `publishing` | Cron job picks up where `scheduled_at <= NOW()` | `app/api/internal/cron/publish-due/route.ts` |
| `scheduled` | `draft` | Author cancels scheduling | `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` |
| `publishing` | `published` | bundle.social webhook delivers success | `app/api/webhooks/bundlesocial/route.ts` |
| `publishing` | `failed` | bundle.social webhook delivers failure | `app/api/webhooks/bundlesocial/route.ts` |
| `failed` | `publishing` | Manual publish trigger (admin retry) | `app/api/platform/social/drafts/[id]/publish/route.ts` |
| `recurring` | `paused` | User pauses series | `app/api/platform/social/drafts/[id]/route.ts` (PATCH) |
| `paused` | `recurring` | User resumes series | `app/api/platform/social/drafts/[id]/route.ts` (PATCH) |

**CAS (Optimistic Locking):** `PATCH /api/platform/social/drafts/[id]` enforces `draft_version` check; mismatches return `409 VERSION_CONFLICT`.

**UI surfaces that render this entity:**
- `/company/social/calendar` — post chips with state-coloured badge; DnD reschedule; composer open in edit mode
- `/company/social/posts` — list rows with state pills; searchable + filterable by state
- `/company/social/posts/[id]` — full detail view; sections conditionally visible by state
- `/company/social/calendar?compose=[id]` — composer opened in edit mode for existing draft
- `/approve/[token]` — external approval via magic link; renders snapshot read-only + decision form
- `/viewer/[token]` — public schedule viewer; approved/scheduled/published states only

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `scheduled` draft be edited by an editor (not just converted back to draft)?
- [ ] Can a `published` draft ever be re-edited (e.g. to update tracking links)?
- [ ] What user-facing label is shown for `pending_approval` in the UI pills?
- [ ] When a `recurring` series is `paused`, are future child instances pre-scheduled or generated on resume?
- [ ] What is the maximum number of publish retries allowed before a draft stays in `failed`?
- [ ] Can a `rejected` draft be deleted, or must it be converted back to `draft` first?
- [ ] Who can see a `pending_approval` draft — the author, the approver, all company members, or admins only?
- [ ] Is there a notification to the author when a `pending_approval` draft moves to `scheduled`?

---

## social_connections

**Table:** `social_connections`
**State column:** `status` TEXT (mirrors `social_connection_status` DB enum conceptually; TypeScript enum is the source of truth)
**TypeScript type:** `SocialConnectionStatus` in `lib/platform/social/connections/types.ts:10-20`
**Migration:** `0070_platform_foundation.sql` (initial states); `0122_social_connections_identity_fingerprints.sql` (added `pending_identity`)

**States:**

| State | Meaning |
|-------|---------|
| `healthy` | Connection active and publishing-ready; all permissions granted |
| `degraded` | Partial functionality; some permissions revoked by user at the platform level |
| `auth_required` | OAuth credentials expired or revoked; user must reconnect via the OAuth flow |
| `disconnected` | Explicitly disconnected by admin, or removed at the platform level |
| `pending_identity` | OAuth flow complete but channel/page selection not yet done; `external_account_id` or `external_user_id` is null |

**Status UI labels** (from `lib/platform/social/connections/types.ts:61-67`):

| State | Label | Pill colour |
|-------|-------|-------------|
| `healthy` | "Healthy" | green (`bg-success-bg text-success-fg`) |
| `degraded` | "Degraded" | yellow (`bg-warning-bg text-warning-fg`) |
| `auth_required` | "Reconnect required" | red (`bg-danger-bg text-danger-fg`) |
| `disconnected` | "Disconnected" | grey (`bg-muted text-muted-foreground`) |
| `pending_identity` | "Pending channel selection" | yellow (`bg-warning-bg text-warning-fg`) |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `pending_identity` | OAuth callback completes but channel not yet selected | `app/api/platform/social/connections/callback/route.ts` |
| `pending_identity` | `healthy` | User selects channel / page | `app/api/platform/social/connections/[id]/set-channel/route.ts` |
| `pending_identity` | `healthy` | User connects as personal (LinkedIn) | `app/api/platform/social/connections/[id]/connect-as-personal/route.ts` |
| `healthy` | `auth_required` | Platform OAuth token expires or permissions revoked (detected by cron or webhook) | `app/api/cron/social-connections-health/route.ts` |
| `healthy` | `degraded` | Partial permission revocation detected | `app/api/cron/social-connections-health/route.ts` |
| `healthy` | `disconnected` | Admin explicitly disconnects | `app/api/platform/social/connections/[id]/disconnect/route.ts` |
| `auth_required` | `healthy` | Admin completes reconnect OAuth flow | `app/api/platform/social/connections/reconnect/route.ts` |
| `degraded` | `healthy` | Admin reconnects to restore full permissions | `app/api/platform/social/connections/reconnect/route.ts` |
| `disconnected` | — | Reconnect creates a new row rather than updating status | `app/api/platform/social/connections/connect/route.ts` |

**Publishing gate:** Only `healthy` connections are eligible for publishing (`claim_publish_job` RPC has `status='healthy'` gate). `pending_identity` connections are rejected at the publishing layer.

**UI surfaces that render this entity:**
- `/company/social/connections` — per-row status pills; Reconnect button (admin only)
- `/admin/companies/[id]/social-profiles/[profileId]/connections` — admin view with reattribution
- `/admin/maintenance/social-connections` — reconcile, refresh identity, reattribute

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `disconnected` connection be reconnected in-place, or does reconnect always create a new row?
- [ ] What happens to `scheduled` drafts when a connection moves to `auth_required` — are they blocked at publish time or immediately flagged?
- [ ] When does the `has_emitted_overdue_event` flag get set for `pending_identity` connections?
- [ ] Is there a UI affordance on `/company/social/calendar` to warn users about `auth_required` connections?

---

## platform_invitations

**Table:** `platform_invitations`
**State column:** `status` ENUM `platform_invitation_status`
**TypeScript type:** Inline SQL enum in `0070_platform_foundation.sql:93-97`
**Migration:** `0070_platform_foundation.sql`

**States:**

| State | Meaning |
|-------|---------|
| `pending` | Invitation sent; email delivered; waiting for recipient to claim |
| `accepted` | Recipient claimed the invitation and created / linked their account |
| `expired` | Invitation was not claimed within the expiry window |
| `revoked` | Admin manually revoked the invitation before it was claimed |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `pending` | Admin sends invitation | `app/api/admin/invites/route.ts` (POST) or `app/api/platform/invitations/route.ts` (POST) |
| `pending` | `accepted` | Recipient visits invite link and sets credentials | `app/api/platform/invitations/accept/route.ts` or `app/api/auth/accept-invite/route.ts` |
| `pending` | `expired` | Expiry cron runs after TTL passes | `app/api/platform/invitations/callbacks/expiry/route.ts` |
| `pending` | `revoked` | Admin revokes invitation | `app/api/admin/invites/[id]/route.ts` (DELETE/PATCH) or `app/api/platform/invitations/[id]/route.ts` (DELETE) |

**Uniqueness constraint:** `idx_invitations_unique_pending` prevents two pending invitations for the same email + company combination.

**UI surfaces that render this entity:**
- `/admin/companies/[id]` — pending invitations list
- `/company/users` — pending invitations list
- `/invite/[token]` — invitation claim page
- `/auth/accept-invite` — invitation acceptance

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the invitation TTL (hours/days before auto-expiry)?
- [ ] Is the recipient notified when their invitation expires?
- [ ] Can an admin re-invite someone after their invitation expired?
- [ ] Can a `revoked` invitation be reinstated, or must a new one be issued?

---

## opt_proposals (Optimiser)

**Table:** `opt_proposals`
**State column:** `status` TEXT CHECK constraint
**TypeScript type:** Inline in Optimiser libs
**Migration:** `0053_optimiser_brief_submission.sql` (extended with `applying` and `applied_then_failed`); earlier migration established initial states

**States:**

| State | Meaning |
|-------|---------|
| `draft` | Proposal drafted internally; not yet submitted for approval |
| `pending` | Proposal submitted and awaiting approval decision |
| `approved` | Operator approved the proposal; ready to apply |
| `applying` | Brief generation triggered; `brief_run` is queued or running |
| `applied` | Brief run completed successfully; changes deployed to WP |
| `applied_promoted` | Changes verified in production and promoted to canonical |
| `applied_then_reverted` | Applied changes were rolled back to previous version |
| `applied_then_failed` | Brief run terminated in `failed` state; operator notified |
| `rejected` | Proposal rejected; not to be applied |
| `expired` | Proposal was not acted upon within the expiry window |

**Canonical state machine comment** (from migration `0053_optimiser_brief_submission.sql:44`):
> `draft → pending → approved → applying → applied → applied_promoted | applied_then_reverted | applied_then_failed; OR pending → rejected | expired`

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| `draft` | `pending` | Operator submits for approval | `app/api/optimiser/proposals/[id]/route.ts` (PATCH) |
| `pending` | `approved` | Admin approves | `app/api/optimiser/proposals/[id]/approve/route.ts` |
| `pending` | `rejected` | Admin rejects | `app/api/optimiser/proposals/[id]/reject/route.ts` |
| `pending` | `expired` | Expiry cron runs | `app/api/cron/optimiser-expire-proposals/route.ts` |
| `approved` | `applying` | Brief run triggered on approval | `app/api/optimiser/proposals/[id]/approve/route.ts` |
| `applying` | `applied` | Brief run succeeds | `app/api/cron/process-brief-runner/route.ts` via `brief_run.triggered_by_proposal_id` |
| `applying` | `applied_then_failed` | Brief run terminates in `failed` | `app/api/cron/process-brief-runner/route.ts` |
| `applied` | `applied_promoted` | Staged rollout monitor promotes | `app/api/cron/optimiser-monitor-rollouts/route.ts` |
| `applied` | `applied_then_reverted` | Admin rollback | `app/api/optimiser/proposals/[id]/rollback/route.ts` |
| `applied_promoted` | `applied_then_reverted` | Admin rollback post-promotion | `app/api/optimiser/proposals/[id]/rollback/route.ts` |

**UI surfaces that render this entity:**
- `/optimiser/proposals` — list with status pills
- `/optimiser/proposals/[id]` — full detail with `ProposalReview`, `ProposalAppliedMoment`, action buttons

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] In `applying` state, are the Approve/Reject buttons disabled on the detail page?
- [ ] What notification is sent when a proposal moves to `applied_then_failed`?
- [ ] Can an `expired` proposal be manually reactivated?
- [ ] Can an `applied_then_reverted` proposal be re-applied without going through `pending` again?

---

## cap_campaigns

**Table:** `cap_campaigns`
**State column:** `status` TEXT CHECK constraint
**TypeScript type:** Inferred from DB schema
**Migration:** `0137_cap_phase_1_schema.sql:197-201`

**States:**

| State | Meaning |
|-------|---------|
| `draft` | Campaign created but generation not yet triggered |
| `generating` | AI content generation in progress |
| `review` | Generation complete; posts ready for admin review |
| `approved` | All post slots approved; ready to push to social composer |
| `pushed` | Posts pushed to social_post_drafts; linked to the company's social pipeline |
| `published` | All campaign posts have published (terminal) |
| `archived` | Campaign manually archived |
| `failed` | Generation failed; error state |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| `draft` | `generating` | Admin triggers generation | `app/api/platform/cap/campaigns/[id]/generate/route.ts` |
| `generating` | `review` | Generation job completes | `app/api/cron/cap-weekly-generation/route.ts` or `app/api/cron/cap-monthly-generation/route.ts` |
| `generating` | `failed` | Generation job fails | Cron error handling |
| `review` | `approved` | All `cap_campaign_posts` approved | `app/api/platform/cap/campaign-posts/[id]/status/route.ts` |
| `approved` | `pushed` | Posts pushed to social composer | `app/api/platform/cap/campaign-posts/[id]/push/route.ts` |
| `pushed` | `published` | All campaign posts published (driven by webhook) | `app/api/webhooks/bundlesocial/route.ts` |
| Any | `archived` | Admin archives | Admin action |
| `failed` | `generating` | Admin retriggers generation | `app/api/cron/cap-generation-runs-cleanup/route.ts` |

**UI surfaces that render this entity:**
- `/admin/companies/[id]/cap/campaigns` — campaigns list
- `/admin/companies/[id]/cap/campaigns/[campaignId]` — campaign detail with post slots

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a `generating` campaign be cancelled?
- [ ] What happens when only some post slots are approved — does the campaign move to `approved` or does it require all four?
- [ ] Can individual posts from a `pushed` campaign be pulled back (unconverted from draft)?
- [ ] Is there a generation cost estimate shown before triggering?

---

## cap_campaign_posts

**Table:** `cap_campaign_posts`
**State column:** `status` TEXT CHECK constraint
**TypeScript type:** Inferred from DB schema
**Migration:** `0137_cap_phase_1_schema.sql:260-265`

**States:**

| State | Meaning |
|-------|---------|
| `pending` | Post slot exists; generation not yet attempted |
| `generated` | AI content generated; awaiting admin review |
| `approved` | Admin approved this post slot |
| `rejected` | Admin rejected this post slot |
| `pushed` | Pushed to `social_post_drafts`; `social_draft_id` FK is set |
| `published` | Corresponding social draft has published |
| `failed` | Generation or push failed |
| `approved_past_due` | Approved after the scheduled publish window has passed |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| `pending` | `generated` | CAP generation completes for this slot | Cron or `app/api/platform/cap/campaigns/[id]/generate/route.ts` |
| `pending` | `failed` | Generation fails | Error handling |
| `generated` | `approved` | Admin approves | `app/api/platform/cap/campaign-posts/[id]/status/route.ts` |
| `generated` | `rejected` | Admin rejects | `app/api/platform/cap/campaign-posts/[id]/status/route.ts` |
| `rejected` | `generated` | Admin triggers regeneration | `app/api/platform/cap/campaign-posts/[id]/regenerate/route.ts` |
| `approved` | `pushed` | Admin pushes to composer | `app/api/platform/cap/campaign-posts/[id]/push/route.ts` |
| `approved` | `approved_past_due` | Publish window passes without push | Cron monitor |
| `pushed` | `published` | Linked draft publishes (webhook) | `app/api/webhooks/bundlesocial/route.ts` |
| `failed` | `generated` | Admin retriggers generation | `app/api/platform/cap/campaign-posts/[id]/regenerate/route.ts` |

**UI surfaces that render this entity:**
- `/admin/companies/[id]/cap/campaigns/[campaignId]` — 4 post slot rows with per-slot status

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens to an `approved_past_due` post — is it still pushable?
- [ ] When a post slot is in `pushed` state, does a link to the social draft appear in the UI?
- [ ] Can a `pushed` post be pulled back (deleted from social drafts) and regenerated?

---

## cap_subscriptions

**Table:** `cap_subscriptions`
**State column:** `status` TEXT CHECK constraint
**TypeScript type:** Inferred from DB schema
**Migration:** `0137_cap_phase_1_schema.sql:77-78`

**States:**

| State | Meaning |
|-------|---------|
| `trial` | Company is in CAP trial period; `trial_ends_at` is set |
| `active` | Active paid subscription |
| `paused` | Subscription paused (billing or voluntary); campaign generation halted |
| `cancelled` | Subscription cancelled; `cancelled_at` is set |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `trial` | Admin provisions CAP for company | Admin action |
| `trial` | `active` | Trial converts (admin or billing event) | Admin / billing webhook |
| `trial` | `cancelled` | Trial expires without conversion | Cron or admin |
| `active` | `paused` | Admin or billing pause | Admin action |
| `active` | `cancelled` | Admin or billing cancellation | Admin action |
| `paused` | `active` | Admin resumes | Admin action |

**UI surfaces that render this entity:**
- `/admin/companies/[id]/cap` — subscription status overview

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens to in-flight campaigns when a subscription moves to `paused`?
- [ ] Is there an automated notification when a trial is about to expire?
- [ ] Can a `cancelled` subscription be reinstated?

---

## generation_jobs (batch_run)

**Table:** `generation_jobs` (NOTE: migration uses `generation_jobs` not `batch_run`)
**State column:** `status` TEXT CHECK constraint
**TypeScript type:** Inferred from DB schema
**Migration:** `0007_m3_1_batch_schema.sql:67-70`

**States:**

| State | Meaning |
|-------|---------|
| `queued` | Job created and waiting to be picked up by cron |
| `running` | Cron has started processing; pages being generated |
| `partial` | Some pages succeeded, some failed; run terminated |
| `succeeded` | All requested pages generated successfully |
| `failed` | Generation failed; error logged |
| `cancelled` | Manually cancelled before completion |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `queued` | Admin creates batch or brief triggers generation | `app/api/admin/batch/route.ts` or `app/api/briefs/[brief_id]/run/route.ts` |
| `queued` | `running` | Cron picks up job | `app/api/cron/process-batch/route.ts` or `app/api/cron/process-brief-runner/route.ts` |
| `running` | `succeeded` | All pages generated | Cron finalisation |
| `running` | `partial` | Some pages failed; others succeeded | Cron finalisation |
| `running` | `failed` | All pages failed or critical error | Cron finalisation |
| `queued` | `cancelled` | Admin cancels before run starts | `app/api/admin/batch/[id]/cancel/route.ts` |
| `running` | `cancelled` | Admin cancels mid-run | `app/api/admin/batch/[id]/cancel/route.ts` |

**Active index:** `idx_generation_jobs_active` on `(status)` where `status IN ('queued', 'running')`.

**UI surfaces that render this entity:**
- `/admin/batches` — cross-site batch list
- `/admin/batches/[siteId]` — site-specific batch history
- `/admin/batches/[siteId]/[batchId]` — batch detail with per-page progress
- `/admin/sites/[id]/briefs/[brief_id]/run` — live run progress for brief-triggered jobs

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there a timeout after which a `running` job is automatically moved to `failed`?
- [ ] Can a `partial` job be retried for only the failed pages?
- [ ] Is there a concurrency limit on `running` jobs per site?
- [ ] What notification is sent when a job moves to `failed`?

---

## site_blueprints

**Table:** `site_blueprints`
**State column:** `status` TEXT
**TypeScript type:** Inferred from DB schema
**Migration:** Migration in the M3/M4 range (not independently verified)

**States:**

| State | Meaning |
|-------|---------|
| `draft` | Blueprint generated but not yet reviewed/approved |
| `approved` | Blueprint approved for publishing |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `draft` | Blueprint generated during site setup | Site setup workflow |
| `draft` | `approved` | Admin approves blueprint | `app/api/sites/[id]/blueprints/[blueprint_id]/approve/route.ts` |
| `approved` | (reverted) | Admin reverts blueprint | `app/api/sites/[id]/blueprints/[blueprint_id]/revert/route.ts` |

**UI surfaces that render this entity:**
- `/admin/sites/[id]/blueprints/review` — blueprint review surface

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What exactly is captured in a blueprint (page structure, design tokens, content outline)?
- [ ] Can more than one blueprint per site be in `approved` state simultaneously?
- [ ] What happens to in-progress generation jobs when a blueprint is reverted?

---

## route_registry

**Table:** `route_registry`
**State column:** `status` TEXT
**TypeScript type:** Inferred from DB schema
**Migration:** Not independently verified

**States:**

| State | Meaning |
|-------|---------|
| `planned` | Route is planned but not yet live in WordPress |
| `live` | Route is live and serving content in WordPress |
| `redirected` | Route has been 301-redirected to another URL |
| `removed` | Route has been removed; no longer serving content |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `planned` | Page generation creates route record | Brief run / page generation |
| `planned` | `live` | Page published to WordPress | `app/api/sites/[id]/blueprints/[blueprint_id]/publish-site/route.ts` or publish page tools |
| `live` | `redirected` | Optimiser or admin sets a redirect | Optimiser proposal / admin action |
| `live` | `removed` | Page unpublished or deleted | `app/api/sites/[id]/posts/[post_id]/unpublish/route.ts` |

**UI surfaces that render this entity:**
- `/admin/sites/[id]/content` — site content overview
- Route drift detection cron: `app/api/cron/drift-detect/route.ts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the `drift-detect` cron compare route_registry `status` against live WP to find discrepancies?
- [ ] Are `removed` routes preserved in the registry for audit purposes?

---

## social_publish_attempts

**Table:** `social_publish_attempts`
**State column:** `status` ENUM `social_attempt_status`
**TypeScript type:** `social_attempt_status` in `lib/platform/social/publishing` (inferred)
**Migration:** `0070_platform_foundation.sql:167-174` (enum type definition)

**States:**

| State | Meaning |
|-------|---------|
| `pending` | Attempt row created; not yet submitted to bundle.social |
| `in_flight` | Submitted to bundle.social; awaiting webhook confirmation |
| `unknown` | Response from bundle.social was ambiguous; reconciliation needed |
| `succeeded` | bundle.social confirmed successful publication |
| `failed` | bundle.social confirmed failure; `error_class` and error details populated |
| `reconciling` | Watchdog cron is actively reconciling this attempt |

**State transitions:**

| From | To | Trigger | Code |
|------|----|---------|------|
| (new) | `pending` | Publish job initiates a new attempt | Publishing fire logic |
| `pending` | `in_flight` | HTTP call made to bundle.social | `lib/platform/social/publishing` fire |
| `in_flight` | `succeeded` | bundle.social webhook delivers success | `app/api/webhooks/bundlesocial/route.ts` |
| `in_flight` | `failed` | bundle.social webhook delivers failure | `app/api/webhooks/bundlesocial/route.ts` |
| `in_flight` | `unknown` | bundle.social webhook not received within TTL | `app/api/cron/social-publish-watchdog/route.ts` |
| `unknown` | `reconciling` | Watchdog begins reconciliation | `app/api/cron/social-publish-watchdog/route.ts` |
| `reconciling` | `succeeded` | Reconciliation finds post was published | Watchdog |
| `reconciling` | `failed` | Reconciliation confirms failure | Watchdog |

**Immutability note:** `social_publish_attempts` is an immutable audit log (comment in `0070_platform_foundation.sql:764`). Retry attempts create new rows; they do not update existing ones.

**UI surfaces that render this entity:**
- `/company/social/posts/[id]` — `PostPublishHistorySection` (visible for `publishing|published|failed` states)
- `/admin/companies/[id]/social-profiles/[profileId]/analytics` — analytics referencing attempt history

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How long before a `pending` attempt transitions to `in_flight` — is there a timeout?
- [ ] Is the `unknown` → `reconciling` watchdog transition automatic, and how frequently does the watchdog run?
- [ ] Are `succeeded` attempts shown to company users, or only to admins?
- [ ] What detail does the user see in `PostPublishHistorySection` — status only, or error message as well?

---

## platform_company_users (role)

**Table:** `platform_company_users`
**State column:** `role` TEXT (not a lifecycle state machine, but drives permission gates across the platform)
**TypeScript type:** Inferred from `checkAdminAccess` and `canDo` helpers

**Roles:**

| Role | Scope |
|------|-------|
| `viewer` | Read-only access to calendar, posts, connections, media |
| `editor` | Viewer + create/edit posts |
| `admin` | Editor + manage connections, invite users, manage sharing links |
| `super_admin` | All admin capabilities + access to super_admin-only pages (theming, email-test, user role management, invite) |

**Permission map (canDo):**

| Permission | Minimum role |
|------------|-------------|
| `view_calendar` | viewer |
| `create_post` | editor |
| `edit_post` | editor |
| `approve_post` | editor (named approver) or admin |
| `reject_post` | editor (named approver) or admin |
| `manage_connections` | admin |
| `manage_invitations` | admin |
| `reconnect_connection` | admin |

**UI surfaces that render this entity:**
- `/company/users` — member list with role labels; role change (admin only)
- `/admin/users` — platform-level user list with role management (super_admin only for role change)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can an admin change another admin's role to super_admin?
- [ ] Is the `is_opollo_staff` override a role or a separate flag?
- [ ] What happens to a company's data when the last admin's access is revoked?
