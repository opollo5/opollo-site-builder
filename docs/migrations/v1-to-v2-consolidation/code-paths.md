# Code Paths — V1 and V2 Social Post Tables

All file:line citations verified 2026-05-27. "V1" = social_post_master / social_post_variant / social_schedule_entries. "V2" = social_post_drafts / social_post_approval_decisions.

---

## V1 Code Paths

### Feature area: Calendar / Dashboard

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `app/api/platform/social/posts/route.ts:42–113` | READ social_post_master | GET endpoint — lists posts by state/company with pagination. Calls `listPostMasters` |
| `app/api/platform/social/posts/route.ts:55–113` | INSERT social_post_master | POST endpoint — creates new draft post. Calls `createPostMaster`, optionally creates variants |
| `app/viewer/[token]/page.tsx:68–125` | READ social_post_master, social_post_variant, social_schedule_entries | Public customer calendar — renders approved/scheduled/published posts in 90-day window |
| `lib/platform/social/posts/list.ts:28–78` | READ social_post_master | Company-scoped list with state filter, pagination, full-text search on master_text |
| `lib/platform/social/posts/get.ts:32` | READ social_post_master | Fetch single post by ID |
| `lib/platform/social/posts/dashboard.ts:53–120` | READ social_post_master | Eight parallel COUNT queries for dashboard stats tiles (draft/pending/approved/scheduled/published/changesReq/failed + approvedThisWeek) |
| `lib/platform/social/scheduling/list.ts:34–85` | READ social_post_master, social_post_variant, social_schedule_entries | Three-step join: posts → variants → schedule entries for calendar view |
| `lib/platform/social/scheduling/list-company.ts:66–140` | READ social_post_master, social_post_variant, social_schedule_entries | Company-scoped schedule listing with state=approved filter |

### Feature area: Composer (Post Creation & Editing)

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `lib/platform/social/posts/create.ts:64–76` | INSERT social_post_master | Creates a new draft; always lands in state='draft' |
| `lib/platform/social/posts/update.ts:85–127` | UPDATE social_post_master | Partial update of master_text/link_url; gated to state='draft' only |
| `lib/platform/social/posts/delete.ts:34–64` | DELETE social_post_master | Hard-delete; gated to state='draft' only |
| `lib/platform/social/posts/duplicate.ts:37–102` | READ social_post_master, INSERT social_post_master, READ+INSERT social_post_variant | Clones a post + all its variants into a new draft |
| `lib/platform/social/posts/bulk-create.ts:105` | INSERT social_post_master (batch) | Bulk CSV upload — validates rows then batch-inserts |
| `lib/platform/social/variants/upsert.ts:75–122` | READ social_post_master (state check), UPSERT social_post_variant | Creates/updates a per-platform variant; reads master to gate on state |
| `lib/platform/social/variants/list.ts:39–55` | READ social_post_master, READ social_post_variant | Fetches all connections for the company + joins variant rows; returns "resolved" list with variant-or-master-text |
| `lib/platform/social/cap/generator.ts:33–34` | INSERT social_post_master, INSERT social_post_variant (via createPostMaster + upsertVariant) | CAP Claude generation — creates posts with source_type='cap' + per-platform variants |
| `lib/platform/social/cap/image-trigger.ts:131` | READ social_post_variant | Reads variant to find media_asset_ids for AI image enrichment |

### Feature area: Approval Workflow

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `lib/platform/social/posts/transitions.ts:67–86` | READ social_post_master | submitForApproval: reads post to build approval snapshot |
| `lib/platform/social/posts/transitions.ts` (RPC) | UPDATE social_post_master (via RPC) | submit_post_for_approval RPC — flips state draft→pending_client_approval |
| `lib/platform/social/posts/transitions.ts:268–311` | UPDATE social_post_master | reopenForEditing — flips changes_requested→draft, clears reviewer_comment |
| `lib/platform/social/posts/transitions.ts:414–462` | RPC cancel_post_approval | Reverts pending_client_approval→draft, inserts revoked approval_event |
| `lib/platform/social/posts/transitions.ts:549–598` | UPDATE social_post_master | approvePost — flips pending_client_approval→approved |
| `lib/platform/social/posts/transitions.ts:624–677` | UPDATE social_post_master | rejectPost — flips pending_client_approval→rejected, sets reviewer_comment |
| `lib/platform/social/posts/transitions.ts:702–755` | UPDATE social_post_master | requestChanges — flips pending_client_approval→changes_requested, sets reviewer_comment |
| `lib/platform/social/approvals/decisions/record.ts:116` | READ social_post_master | External-token approval decision: reads master to get state before RPC call |
| `app/api/approve/[token]/decision/route.ts:89–95` | READ social_post_master (via recordApprovalDecision) | External token approval — reads company_id/created_by for notification dispatch post-decision |

### Feature area: Scheduling

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `lib/platform/social/scheduling/create.ts:57–153` | READ social_post_master (state), UPSERT social_post_variant, INSERT social_schedule_entries | Creates schedule entry; verifies approved state, ensures variant exists, inserts schedule row, enqueues QStash |
| `lib/platform/social/scheduling/cancel.ts:37–83` | READ+UPDATE social_schedule_entries, READ social_post_variant, READ social_post_master | Cancel: stamps cancelled_at on schedule entry, reads master to return current state |

### Feature area: Publish Cron (V1 QStash pipeline)

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `app/api/cron/social-publish-backfill/route.ts` | (delegates to lib) | Vercel cron at `*/5 * * * *`. Backfills missed QStash enqueues and auto-retries failed attempts |
| `lib/platform/social/publishing/backfill.ts:119–125` | READ social_schedule_entries | Walk entries with qstash_message_id IS NULL and scheduled_at >= now() |
| `lib/platform/social/publishing/fire.ts:105–111` | READ social_schedule_entries | Timing-drift check: reads scheduled_at to compute publish lateness |
| `lib/platform/social/publishing/fire.ts:136` | RPC claim_publish_job | Atomically claims schedule entry + creates publish_job + attempt; flips master state → publishing |
| `lib/platform/social/publishing/fire.ts:248` | READ social_post_variant | Reads media_asset_ids for bundle.social upload resolution |
| `lib/platform/social/publishing/fire.ts:435` | UPDATE social_post_master | markMasterFailed: flips state publishing→failed on bundle.social call error |
| `lib/platform/social/publishing/retry.ts:152` | READ social_post_variant | Retry: reads variant to get platform + connection_id |
| `lib/platform/social/publishing/retry.ts:319` | UPDATE social_post_master | Retry: flips master state after re-attempt |
| `lib/platform/social/publishing/watchdog.ts:128–162` | READ social_post_variant, READ+UPDATE social_post_master | Stale-claim watchdog: reads in-flight variants, checks time since publish started, fails timed-out masters |
| `lib/platform/social/publishing/enqueue.ts:96` | UPDATE social_schedule_entries | Stamps qstash_message_id after successful QStash enqueue |
| `lib/platform/social/publishing/list-attempts.ts:58` | READ social_post_variant | Lists publish attempts; joins variant to get platform |

### Feature area: Webhooks

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `lib/platform/social/webhooks/process.ts:222–233` | READ social_post_variant, READ social_post_master | post.published / post.failed webhook: traverses attempt→variant→master chain to get company_id/created_by for notifications |
| `lib/platform/social/webhooks/process.ts:264, 313` | UPDATE social_post_master | Flips state to published or failed on webhook receipt (predicate-guarded) |

### Feature area: Analytics

| File | V1 Operation | What it does |
|------|-------------|--------------|
| `lib/platform/social/analytics.ts:104–155` | READ social_post_master (multiple) | BSP analytics queries: reads posts in state=published, joins with variant data for per-platform metrics |
| `lib/platform/social/analytics.ts:190` | READ social_post_variant | Reads variant platform info for analytics join |
| `lib/platform/social/analytics.ts:292–306` | READ social_post_master, READ social_post_variant | Post performance lookup: fetches post content + variant platform for analytics enrichment |
| `lib/insights/source-attribution.ts:20–51` | READ social_post_variant, READ social_post_master | Traverses publish_attempt→variant→master to determine if post was CAP or manual |

---

## V2 Code Paths

### Feature area: Calendar / Dashboard

| File | V2 Operation | What it does |
|------|-------------|--------------|
| `app/api/platform/social/drafts/calendar-view/route.ts:37–46` | READ social_post_drafts | Calendar view: selects id, state, scheduled_at, published_at, content, media_urls, target_profiles, parent_draft_id in date range |
| `app/api/platform/social/drafts/route.ts:69` | INSERT social_post_drafts | V1-legacy blank-draft POST path; also V2 composer creation via handleV2Post |
| `app/api/platform/social/drafts/route.ts:129–211` | INSERT social_post_drafts (batch) | V2 creation: handles draft/schedule/post_now/recurring modes; inserts up to 7 rows for recurring |

### Feature area: Composer (Drafts CRUD)

| File | V2 Operation | What it does |
|------|-------------|--------------|
| `app/api/platform/social/drafts/[id]/route.ts:36–57` | READ social_post_drafts | GET draft — loads full row by id, gated on company_id |
| `app/api/platform/social/drafts/[id]/route.ts:127–244` | UPDATE social_post_drafts | PATCH V2: writes content, media_urls, target_profiles, platform_variants, state, scheduled_at, planned_for_at, approval_required, approver_user_id + mirrors into draft_data blob |
| `app/api/platform/social/drafts/[id]/route.ts:247–272` | UPDATE social_post_drafts | PATCH V1-legacy: CAS update on draft_data blob only |
| `app/api/platform/social/drafts/[id]/route.ts:292–322` | UPDATE social_post_drafts | DELETE (soft): sets archived_at; gated — blocks publishing/published |
| `app/api/platform/social/drafts/bulk/route.ts` | INSERT social_post_drafts | Bulk CSV V2 path (lib/social/bulk-csv/parse.ts feeds this) |
| `app/api/platform/social/drafts/[id]/convert-to-draft/route.ts` | UPDATE social_post_drafts | Converts a scheduled/approved draft back to draft state |
| `lib/platform/social/drafts.ts:64–120` | INSERT social_post_drafts | createDraft: blank draft with optional idempotency_key (CAP + service-auth path) |
| `lib/platform/social/drafts.ts:126–171` | READ social_post_drafts | getDraft: fetch by id + company_id, excludes archived |
| `lib/platform/social/drafts.ts:181–241` | UPDATE social_post_drafts | saveDraft: CAS update on draft_data blob; returns VERSION_CONFLICT with current_draft when version mismatch |

### Feature area: Approval Workflow (V2)

| File | V2 Operation | What it does |
|------|-------------|--------------|
| `app/api/platform/social/drafts/[id]/approve/route.ts:39–41` | READ social_post_drafts | Loads draft to check state=pending_approval and get approver_user_id |
| `app/api/platform/social/drafts/[id]/approve/route.ts:73–78` | UPDATE social_post_drafts | Flips state pending_approval→scheduled (approved) or →rejected |
| `app/api/platform/social/drafts/[id]/approve/route.ts:83–93` | INSERT social_post_approval_decisions | Writes the approval decision record |
| `app/api/review/[token]/decision/route.ts` | READ+UPDATE social_post_drafts, INSERT social_post_approval_decisions | Magic-link external approver decision: JWT-verified token, same state transitions |
| `lib/social/approval/escalate.ts` | READ social_post_drafts, READ social_post_approval_decisions | Escalation logic: finds drafts stuck in pending_approval past deadline |
| `app/api/internal/cron/escalate-approvals/route.ts` | (delegates to escalate.ts) | Vercel cron at `0 */6 * * *` |
| `app/api/platform/social/drafts/[id]/review-link/route.ts` | READ social_post_drafts | Generates signed JWT review token for external approver magic-link |

### Feature area: Publish Cron (V2 direct-pg pipeline)

| File | V2 Operation | What it does |
|------|-------------|--------------|
| `app/api/internal/cron/publish-due/route.ts` | (delegates to claimDueDrafts + svc.from) | Vercel cron at `* * * * *`. Claims and publishes due drafts |
| `lib/social/publishing/claim-due-drafts.ts:31–56` | UPDATE social_post_drafts (raw pg.Client FOR UPDATE SKIP LOCKED) | Atomic batch claim: CTE locks state='scheduled' rows with scheduled_at <= now(), transitions to publishing, stamps publish_claimed_at + publish_worker_id |
| `app/api/internal/cron/publish-due/route.ts:98–105` | UPDATE social_post_drafts | Success writeback: sets state='published', published_at, published_url |
| `app/api/internal/cron/publish-due/route.ts:108–131` | UPDATE social_post_drafts | Failure writeback: sets state back to scheduled (or failed after MAX_PUBLISH_ATTEMPTS), publish_attempts++, clears claim columns, sets last_publish_error |

### Feature area: Analytics (V2)

| File | V2 Operation | What it does |
|------|-------------|--------------|
| `app/api/platform/social/drafts/[id]/analytics/route.ts` | READ social_post_analytics_cache (FK → social_post_drafts) | Returns cached analytics for a V2 draft |

---

## Summary: What V1-Only Routes Exist

These routes/libs use ONLY V1 tables — they have no V2 equivalent and require full migration:

| Route / Lib | V1 table(s) used | Migration complexity |
|------------|-----------------|---------------------|
| `GET /api/platform/social/posts` | social_post_master | Duplicate of calendar-view but column-different |
| `POST /api/platform/social/posts` | social_post_master, social_post_variant | Must switch CAP generator to V2 createDraft path |
| `GET /viewer/[token]` | social_post_master, social_post_variant, social_schedule_entries | Read-only; needs V2 analogue |
| `lib/platform/social/posts/*` (entire directory) | social_post_master | 9 files, full state machine |
| `lib/platform/social/scheduling/*` | social_post_master, social_post_variant, social_schedule_entries | 5 files |
| `lib/platform/social/publishing/*` | social_post_variant, social_schedule_entries + social_post_master | 6 files; tied to claim_publish_job RPC |
| `lib/platform/social/analytics.ts` | social_post_master, social_post_variant | Reads state=published posts for BSP analytics |
| `lib/insights/source-attribution.ts` | social_post_variant, social_post_master | CAP vs manual attribution traversal |
| `app/api/approve/[token]/decision/route.ts` | social_post_master (via recordApprovalDecision) | External-token V1 approval |
| `app/api/cron/social-publish-backfill/route.ts` | social_schedule_entries | Can be retired after V2 pipeline is sole path |
| Postgres RPCs: submit_post_for_approval, record_approval_decision, cancel_post_approval, claim_publish_job, retry_publish_attempt | All V1 tables | Stored procedures; 7 migration files |

## Summary: What V2-Only Routes Exist

These routes use ONLY V2 tables — they survive the migration without change:

- `app/api/platform/social/drafts/*` (all sub-routes)
- `app/api/internal/cron/publish-due/route.ts`
- `app/api/internal/cron/escalate-approvals/route.ts`
- `app/api/review/[token]/decision/route.ts`
- `app/(public)/review/[token]/page.tsx`
- `lib/platform/social/drafts.ts`
- `lib/social/publishing/claim-due-drafts.ts`
- `lib/social/approval/escalate.ts`

## Dual-Mode Files (write to both)

| File | V1 writes | V2 writes | Notes |
|------|-----------|-----------|-------|
| `app/api/platform/social/drafts/[id]/route.ts` | None | social_post_drafts | Has V1-legacy PATCH path (draft_data blob) and V2 PATCH path; routes to one based on 'content' field presence |
| `app/api/platform/social/drafts/route.ts` | None | social_post_drafts | Has V1-legacy blank POST and V2 mode POST |
