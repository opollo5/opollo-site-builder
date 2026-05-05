---
name: n-series-layer-rules
description: Use this skill whenever working on the N-Series social module — lib/platform/social/*, app/company/social/*, app/api/platform/social/*, or any social migration/RPC. Trigger on social_post_master, social_post_variant, social_schedule_entries, social_publish_jobs, social_publish_attempts, social_connections, claim_publish_job, or any state transition in the social state machine. The L1–L7 layer contract is load-bearing; violating it creates orphaned state, double-publishes, or broken audit trails.
---

# N-Series Social Layer Rules

The social module is structured as seven layers (L1–L7). Each layer owns a single concern. Code that belongs in one layer must not bleed into another.

## Layer map

| Layer | Name | Owns |
|-------|------|------|
| L1 | Editorial | `social_post_master` — create, edit, delete, duplicate |
| L2 | Approval | `social_approval_requests`, approval tokens, snapshots, decisions |
| L3 | Scheduling | `social_schedule_entries` — create, cancel, reschedule |
| L4 | Claim | `claim_publish_job` RPC — atomic lock, concurrency cap, state advance |
| L5 | Publish | `fireScheduledPublish` — bundle.social call, attempt tracking |
| L6 | Webhook | Inbound `post.published` / `post.failed` from bundle.social |
| L7 | Watchdog | Stuck `in_flight` recovery, reconciliation cron |

## State machine — social_post_master.state

```
draft
  → pending_client_approval   (submitForApproval)
  → draft                     (cancelApprovalRequest, reopenForEditing)
pending_client_approval
  → approved                  (approvePost via record_approval_decision RPC)
  → rejected                  (rejectPost via record_approval_decision RPC)
  → changes_requested         (requestChanges via record_approval_decision RPC)
  → draft                     (cancelApprovalRequest)
approved
  → scheduled                 (createScheduleEntry)
  → publishing                (claim_publish_job RPC, predicate-guarded)
scheduled
  → publishing                (claim_publish_job RPC, predicate-guarded)
publishing
  → published                 (bundle.social post.published webhook, L6)
  → failed                    (bundle.social post.failed webhook OR watchdog, L7)
rejected / changes_requested
  → draft                     (reopenForEditing)
failed
  → draft                     (manual reset by operator — no automated path)
```

**`pending_msp_release` is locked out.** Migration 0097 adds a CHECK constraint preventing the DB from ever accepting this value. It was never set by any code path; remove any reference to it.

## Concurrency rules (L4)

- `claim_publish_job` is the **only** place that advances `publishing`. No other code path may write `state = 'publishing'`.
- The RPC is predicate-guarded: `UPDATE … WHERE state IN ('approved', 'scheduled')`. If the predicate misses, the RPC raises an exception — caller surfaces as 500, not a silent no-op.
- Concurrent publish cap: `platform_companies.concurrent_publish_limit` (default 5). The RPC counts `social_publish_attempts WHERE status = 'in_flight'` before inserting. Returns `CAPPED` when at or above the cap; caller re-enqueues via QStash with 30 s delay.
- UNIQUE constraint on `social_publish_jobs(schedule_entry_id)` prevents double-claim under race; second claimer gets `ALREADY_CLAIMED`.

## Watchdog rules (L7)

Watchdog cron fires every 5 minutes (`/api/cron/social-publish-watchdog`). Stuck threshold: `in_flight` attempts older than 3 minutes.

For each stuck attempt:
1. Predicate-guarded update: `status = 'failed'` WHERE `status = 'in_flight'`.
2. Resolve `post_master_id` via `post_variant_id`.
3. Predicate-guarded update: master `state = 'failed'` WHERE `state = 'publishing'`.
4. Dispatch `post_failed` notification.

The watchdog never touches `social_publish_jobs` or `social_schedule_entries` — those are L3/L4 concerns.

## Key invariants

- Every `in_flight` attempt has exactly one parent `publish_job`, which has exactly one `schedule_entry`.
- A master in `publishing` has exactly one `in_flight` attempt (enforced by the UNIQUE constraint + predicate guard).
- `state_changed_at` is updated atomically with every state change. Never update `state` without updating `state_changed_at`.
- `social_publish_attempts.company_id` is required (migration 0074). Always include it on INSERT.

## File locations

```
lib/platform/social/
├── posts/           # L1 — editorial CRUD (create, get, list, update, delete, transitions, dashboard)
├── approvals/       # L2 — approval request lifecycle
├── scheduling/      # L3 — schedule entries
├── publishing/
│   ├── fire.ts      # L5 — fireScheduledPublish + QStash CAPPED re-enqueue
│   └── watchdog.ts  # L7 — stuck in_flight recovery
├── connections/     # connection health, reconnect
├── variants/        # per-platform post variants
├── media/           # media asset upload, resolve bundle uploadIds
├── analytics.ts     # read-only analytics aggregation
├── cap/             # Content Automation Pipeline (CAP) — AI copy generation
└── webhooks/        # L6 — inbound bundle.social webhook handlers
```

## Migrations that matter

| Migration | What it added |
|-----------|---------------|
| 0070 | Foundation schema, all social tables, `claim_publish_job` RPC v1, `pending_msp_release` enum value |
| 0074 | Audit columns, `social_publish_attempts.company_id` NOT NULL |
| 0096 | Concurrent publish cap check inside `claim_publish_job` |
| 0097 | CHECK constraint locking out `pending_msp_release` |
