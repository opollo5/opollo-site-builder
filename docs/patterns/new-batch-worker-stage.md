# Pattern — New batch-worker stage

## When to use it

Adding a processing stage to the M3 batch worker: pre-processing check, post-processing action, billing hook, new quality gate, retry-budget policy change. Applies any time work is threaded through `processSlotAnthropic` / `processSlotDummy` / `publishSlot`.

Past examples: M3-3 (dummy processor), M3-4 (Anthropic + idempotent billing), M3-5 (quality gates), M3-6 (WP publish + adoption), M3-7 (retry loop), M3-8 (cancel + progress).

Don't use for: new batch creation endpoints (those are [`new-api-route.md`](./new-api-route.md) shaped); new cron entrypoints (those are their own thing); UI over batch state (that's [`new-admin-page.md`](./new-admin-page.md)).

## Required files

| File | Role |
| --- | --- |
| `lib/batch-worker.ts` or `lib/batch-publisher.ts` | The processor function. Extend, don't fork — every slot flows through one pipeline. |
| Migration (if the stage adds state) | New column / constraint on `generation_job_pages` or `generation_events`. See [`new-migration.md`](./new-migration.md). |
| `lib/__tests__/batch-worker-<stage>.test.ts` | Stage-specific coverage. |
| `lib/anthropic-pricing.ts` / `lib/quality-gates.ts` / etc. | Per-stage helper(s). One module per concern, no god files. |

## Scaffolding

### Contract

The worker loop processes one slot at a time:

```
leaseNextPage()            → slot locked, state → 'leased'
processSlot<Processor>()   → state walks: leased → generating → validating → publishing → succeeded | failed
heartbeat()                → extends lease during long operations
job-aggregation UPDATE     → flips parent generation_jobs.status when last slot finishes
```

Every stage you add slots into this walk. Rules:

- **State transitions are one-way.** `succeeded → leased` is not a valid move. The CHECK constraint on `generation_job_pages.state` enforces it; never work around.
- **Write the event log first, then the state column.** `generation_events` is the append-only truth for billing + reconciliation. If the slot update fails, the event log still reflects what happened.
- **Idempotency keys are pre-computed at slot insert.** `anthropic_idempotency_key` + `wp_idempotency_key` are derived deterministically from `(job_id, slot_index)` in the migration. New stages that call external APIs must reuse these — don't mint a fresh key on retry.
- **Every external call is behind a retryability verdict.** `RetryableError` vs `NonRetryableError`. Retryable → defer to `retry_after`. Non-retryable → slot goes `failed`, cost is still recorded.
- **Cancellation check at every stage boundary.** Read `generation_jobs.cancel_requested_at`; if present, short-circuit the slot to `skipped` without further work (but let an in-flight external call finish — the top-branch CASE in job-aggregation preserves `cancelled` status even if the slot succeeds).

### Writing the stage

Model on `lib/batch-worker.ts` → `processSlotAnthropic`. Shape:

```ts
export async function processSlot<Stage>(slotId: string, workerId: string): Promise<void> {
  // 1. Transition state: update generation_job_pages
  //    SET state='<new>', updated_at=now()
  //    WHERE id=$1 AND worker_id=$2 AND lease_expires_at > now()
  //    Assert 1 row updated; else the lease was reaped. Log + return.

  // 2. Check cancellation.
  //    SELECT cancel_requested_at FROM generation_jobs WHERE id=$slot.job_id.
  //    If set, state='skipped', log event, return.

  // 3. Do the work (external call, gate run, whatever the stage is).
  //    Wrap in try/catch for Error; classify as retryable or non-retryable.

  // 4. Write the event log.
  //    INSERT generation_events (job_id, slot_id, type, payload_jsonb).

  // 5. Update slot state.
  //    UPDATE generation_job_pages SET state='<next>', ... WHERE id=$1.

  // 6. If terminal: update generation_jobs counters via job-aggregation UPDATE.
}
```

Key snippets:

- **Lease coherence UPDATE** — always filter on `worker_id = $workerId AND lease_expires_at > now()`. Asserts this worker still owns the lease; a reaper can snatch it while a slow external call runs.
- **Heartbeat during slow work** — call `heartbeat()` mid-stage for calls that might exceed the lease duration (Anthropic under contention, WP rate limiting).
- **Job-aggregation UPDATE on terminal transitions** (succeeded / failed / skipped):
  ```sql
  UPDATE generation_jobs SET
    status = CASE
      WHEN status IN ('cancelled','failed') THEN status  -- never flip terminal back
      WHEN succeeded_count + failed_count + skipped_count >= requested_count THEN ...
      ELSE 'processing'
    END,
    succeeded_count = ..., failed_count = ..., skipped_count = ...,
    finished_at = CASE WHEN ... THEN now() ELSE finished_at END
  WHERE id = $1;
  ```
  The top-branch `WHEN status IN ('cancelled','failed')` is how M3-8 preserves cancellation.

### External API calls

For new external dependencies:

- **Idempotency key** reused across retries. Never a fresh UUID per attempt.
- **Cost capture before the API call** — record the quote; on success, record the delta in a second event.
- **SAVEPOINT wrapper** if the call is inside an explicit transaction that also does INSERT on a UNIQUE-constrained table. Unique-violation aborts the whole tx without a SAVEPOINT. (PR #35 fix.)
- **Retry budget** honours `generation_job_pages.retry_count` + the migration that added `retry_after`. Exponential backoff: 1s → 5s → (terminal at 3). Configurable at the migration level, not hard-coded.
- **Classify failures** — non-retryable codes (400 / 401 / 403 / 404 / slug-conflict) terminate the slot; retryable (429 / 5xx / network) go back to `pending` with `retry_after`.

## Required tests

1. **Happy path** — slot walks through the new stage and reaches a terminal state. Assertion covers both the `generation_job_pages.state` final value and the event log's event type.
2. **External API stub failure — retryable.** Stage defers with `retry_after` set. Retry count increments. After N attempts budget exhausts, slot goes `failed`.
3. **External API stub failure — non-retryable.** Slot goes `failed` on first attempt. Cost still recorded if the call was billed.
4. **Lease reaped mid-stage.** Worker starts, lease expires, another worker picks up via `reapExpiredLeases`. Second run reuses the idempotency key — no double billing.
5. **Cancellation short-circuit.** Set `cancel_requested_at` before the stage runs. Slot goes `skipped` without calling the external API.
6. **Cancellation during in-flight work.** Stage starts, `cancel_requested_at` is set, stage completes normally; assert parent job stays `cancelled` (job-aggregation's top-branch CASE).
7. **Idempotency on reprocessing.** Run the same slot through the stage twice; external-call stub observes the same idempotency key both times.
8. **Cost reconciliation.** Sum `cost_cents` from `generation_events` for the slot; assert it equals `generation_job_pages.cost_cents`. Event log is truth.

Model on `lib/__tests__/batch-worker-anthropic.test.ts` and `batch-worker-retry.test.ts`.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape:

`feat(m3-<N>): <stage name>`

E.g. `feat(m3-5): quality gate runner (5 substantive gates, 3 deferred)`, `feat(m3-7): retry loop with exponential backoff + budget cap`.

The "Risks identified and mitigated" section MUST explicitly cover:

- **Billed external calls** — idempotency key, event-log-first accounting.
- **Concurrent workers** — `FOR UPDATE SKIP LOCKED` on lease, top-branch CASE on status flips, UNIQUE constraint on any pre-commit claim.
- **Retry budget** — how the backoff is computed, what the terminal condition is, how `retry_after` interacts with `leaseNextPage`.
- **Cancellation interaction** — what happens to in-flight slots, what happens to pending slots, what the aggregate status reflects.

## Known pitfalls

- **Minting a fresh idempotency key on retry.** Double-bills. Keys are pre-computed at insert time on `generation_job_pages.anthropic_idempotency_key` / `wp_idempotency_key`; reuse those.
- **Updating the slot state column before writing the event log.** If the slot update races / fails, the event log has no record — can't reconcile billing. Always write the event first.
- **Forgetting the lease-coherence filter on UPDATE.** `SET state='...' WHERE id = $1` without the `worker_id + lease_expires_at` check lets a reaped-and-relet slot get clobbered by the first worker's late write.
- **Missing SAVEPOINT around UNIQUE-violation inserts inside a larger tx.** Unique-violation (23505) aborts the transaction (25P02); `ROLLBACK TO SAVEPOINT pages_insert` lets the outer work continue. PR #35 fix.
- **Top-branch CASE missing from job-aggregation UPDATE.** A late-completing slot flips `status = 'cancelled'` back to `succeeded`. Always check `status IN ('cancelled','failed')` first in the CASE.
- **Retryable verdict flip in the test fixture after migration.** M3-7 changed `processSlotAnthropic`'s behaviour: retryable failures now defer, not terminally fail. Existing tests asserting "terminal on retryable error" needed their stub's error flipped to non-retryable. Old tests that don't match the new contract need rewriting, not skipping.
- **Not honouring `retry_after` in `leaseNextPage`.** The function must filter `WHERE retry_after IS NULL OR retry_after <= now()` — otherwise a deferred slot gets re-leased immediately. M3-7 shipped with this check; future worker changes shouldn't drop it.
- **Heartbeat loop deadlock.** A heartbeat UPDATE that contends with a reaper UPDATE under certain isolation levels can deadlock both transactions. Keep heartbeats short; don't wrap them in an outer tx.

## Pointers

- Shipped examples: `lib/batch-worker.ts` (core loop), `lib/batch-publisher.ts` (WP publish stage), `lib/quality-gates.ts` (gates), `lib/anthropic-call.ts` + `lib/anthropic-pricing.ts` (Anthropic stage).
- Related: [`new-migration.md`](./new-migration.md) (adding state), [`ship-sub-slice.md`](./ship-sub-slice.md).
- `docs/PROMPT_VERSIONING.md` — where prompt-injection defence + cost budget land once they ship.
