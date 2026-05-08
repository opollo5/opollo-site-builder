---
id: ADR-0002
title: Draft ownership and versioning
status: Accepted
date: 2026-05-08
deciders: Build Proposal v2
---

## Decision

Drafts use **optimistic concurrency via `draft_version INT`**. The save endpoint performs a CAS (compare-and-swap) UPDATE:

```sql
UPDATE social_drafts
SET body = $body, draft_version = draft_version + 1, updated_at = now(), updated_by = $user_id
WHERE id = $id AND draft_version = $expected_version
```

A 0-rows result → HTTP 409. The UI shows a **"Reload latest"** prompt (last-write-wins-with-warning, not silent overwrite).

## Schema columns

- `draft_version INT NOT NULL DEFAULT 1` — bumped on every save
- `updated_at TIMESTAMPTZ` — server-set on every save
- `updated_by UUID` — references the saving user

## Lifecycle

| Event | Action |
|---|---|
| Post published | Hard delete draft row |
| 365 days inactive | Archive draft to S3; delete DB row |
| Company deleted | CASCADE delete all drafts |

## Rationale

Optimistic CAS is cheaper than advisory locks and fits the low-concurrency reality (one author per post, brief multi-tab sessions). Silent last-write-wins would lose work; the "Reload" prompt warns the author before overwriting.

## Consequences

- Every save call must carry the `draft_version` it observed when loading.
- The composer state machine transitions to `recovering` on a 409.
- No distributed lock infrastructure required.
