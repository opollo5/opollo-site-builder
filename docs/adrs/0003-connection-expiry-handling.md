---
id: ADR-0003
title: Connection expiry handling
status: Accepted
date: 2026-05-08
deciders: Build Proposal v2
implemented-by: supabase/migrations/0110_social_connections_expiry.sql
---

## Decision

Add `expires_at TIMESTAMPTZ NULL` and `last_validated_at TIMESTAMPTZ NULL` to `social_connections` (migration 0110).

## Write paths

| Source | Column written |
|---|---|
| Platform webhook (primary) | `expires_at` |
| Daily health cron | `last_validated_at` (for connections not refreshed in 24 h) |

## Pre-expiry warning query

```sql
SELECT id FROM social_connections
WHERE expires_at < NOW() + INTERVAL '7 days'
  AND expires_at > NOW()
  AND status = 'healthy';
```

Covered by the partial index `idx_connections_expires_at WHERE expires_at IS NOT NULL`.

## NULL semantics

- `expires_at IS NULL` → no expiry information available; **not an error**, not a warning.
- `last_validated_at IS NULL` → never explicitly validated; connection treated as healthy unless `status` says otherwise.

## Notification cadence (see ADR 0004)

Pre-expiry warnings fire at T-7, T-3, T-1. Warning fires only when `expires_at IS NOT NULL`.

## Consequences

- Zero risk to existing rows — additive migration only.
- Rollback: `supabase/rollbacks/0110_social_connections_expiry.down.sql`.
