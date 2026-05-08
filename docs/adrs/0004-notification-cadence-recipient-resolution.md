---
id: ADR-0004
title: Notification cadence and recipient resolution
status: Accepted
date: 2026-05-08
deciders: Build Proposal v2
implemented-by: supabase/migrations/0111_platform_events.sql
---

## Decision

Notifications are dispatched by a cron job that reads `platform_events` and enforces cadence windows before sending.

## Cadence

| Trigger | Fire schedule |
|---|---|
| Connection broken | Day 1, Day 3, Day 7 |
| Connection pre-expiry | T-7, T-3, T-1 |
| Post publish failed | Once |

## Recipient resolution

Notifications go to all of:
1. Users with `reviewer` or `approver` role in the relevant company
2. Opollo staff with the `social_media_manager` role
3. Any `platform_users` row with `is_opollo_staff = true`

## Channels

| Severity | Channels |
|---|---|
| `critical` | email + in-app |
| `warning` | email + in-app |
| `info` | in-app only |

## Dedup

Before any notification send, the cron queries:

```sql
SELECT id FROM platform_events
WHERE event_type = $type
  AND entity_id = $entity_id
  AND recipient_id = $recipient_id
  AND notification_sent_at > NOW() - $window
LIMIT 1;
```

Dedup windows: connection events → 24 h; post failures → 1 h.

Covered by `idx_platform_events_dedup` partial index.

## Consequences

- `platform_events` is the single source of truth for notification history.
- The cron is idempotent: re-running it never double-sends within a dedup window.
- Rollback: `supabase/rollbacks/0111_platform_events.down.sql`.
