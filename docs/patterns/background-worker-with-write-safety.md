# Pattern — Background worker with write safety

## When to use it

Any process that leases a row, does work (possibly slow, possibly hitting external APIs), and commits a terminal state transition. Applies to: batch generators, cron-invoked workers, reconciliation jobs, any other long-running transform over a queue of rows.

For new processing stages inside an existing worker (a new gate, a new billing hook, a new retry policy), see [`new-batch-worker-stage.md`](./new-batch-worker-stage.md) — that's the slice-level pattern. This file is the general playbook for greenfield workers.

Don't use for: request-scoped work (use a normal API route), fire-and-forget jobs with no correctness guarantees (use a queue + ack). The write-safety machinery here — lease, heartbeat, reaper, idempotency — only earns its keep when correctness matters.

## The five invariants

A worker that can't restart safely doesn't ship. Every new worker satisfies all five:

1. **Atomic lease.** A slot is leased by exactly one worker. `SELECT ... FOR UPDATE SKIP LOCKED` under a transaction, flip state to `leased`, stamp `worker_id + lease_expires_at`. Two workers leasing the same slot is a bug a UNIQUE or a CHECK constraint must make impossible.
2. **Heartbeat during slow work.** Any operation that might exceed the lease window calls `heartbeat(slotId, workerId)` at intervals shorter than the window. Heartbeat UPDATE is guarded on `worker_id = $workerId` so a reaped + relet slot rejects the stale update.
3. **Reaper for expired leases.** Separate worker-invocable function resets `state='leased'` rows with `lease_expires_at < now()` back to `state='pending'`. Idempotent under concurrent reapers — two reapers running at the same instant produce the same post-state, no double-reap side effects.
4. **Pre-computed idempotency keys.** Any external billed call (Anthropic, Stripe, SendGrid) uses a key derived deterministically from row identity, stamped at insert time. Re-processing a reaped slot reuses the same key. Never mint a fresh UUID per attempt.
5. **Event-log-first accounting.** `INSERT INTO <job_events>` before the state column flips. If the state-column UPDATE fails (crash, disconnect, trigger-level conflict), the event log still has the truth. Reconciliation reads events, not state.

If any of these is weak, the worker can double-bill, double-publish, or stall forever under a reaper loop.

## Required files

| File | Role |
| --- | --- |
| Migration: `supabase/migrations/0NNN_<worker>.sql` | Tables with `state`, `worker_id`, `lease_expires_at`, `retry_after`, `retry_count`, CHECK on state transitions, UNIQUE on idempotency keys. |
| `lib/<worker>.ts` | `leaseNext<Unit>`, `heartbeat`, `reapExpiredLeases`, `process<Unit>`. One function per contract. |
| `lib/<worker>-events.ts` (optional) | Event-log writer, one function per event type. Keeps the processor tidy. |
| `app/api/cron/<worker>/route.ts` | Cron entrypoint. `Authorization: Bearer $CRON_SECRET` check, `reapExpiredLeases()` first, then one `leaseNext + process` invocation. Cap at one unit per tick. |
| `lib/__tests__/<worker>-lease.test.ts` | 4-worker concurrency test. See [`concurrency-test-harness.md`](./concurrency-test-harness.md). |
| `lib/__tests__/<worker>-reap.test.ts` | Reaper idempotency under concurrency. |
| `lib/__tests__/<worker>-heartbeat.test.ts` | Heartbeat guards against stolen leases. |
| `lib/__tests__/<worker>-crash.test.ts` | Crash at every intermediate state → reap → reprocess → terminal. |
| `lib/__tests__/<worker>-retry.test.ts` | Retryable vs non-retryable failures; budget exhaustion. |

## Scaffolding

### Schema

Model on `supabase/migrations/0007_m3_1_batch_schema.sql` (the `generation_job_pages` table). Minimum column set for a workable unit row:

```sql
CREATE TABLE <worker>_units (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES <worker>_jobs(id) ON DELETE CASCADE,
  slot_index     integer NOT NULL,
  state          text NOT NULL DEFAULT 'pending',
  worker_id      text NULL,
  lease_expires_at timestamptz NULL,
  retry_count    integer NOT NULL DEFAULT 0,
  retry_after    timestamptz NULL,
  <idempotency_key> text NOT NULL,   -- deterministic, pre-computed at insert
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT <worker>_units_state_valid
    CHECK (state IN ('pending','leased','processing','succeeded','failed','skipped')),

  CONSTRAINT <worker>_units_lease_coherent
    CHECK (
      (state = 'pending'  AND worker_id IS NULL AND lease_expires_at IS NULL)
      OR
      (state IN ('leased','processing') AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR
      (state IN ('succeeded','failed','skipped'))
    ),

  UNIQUE (job_id, slot_index),
  UNIQUE (<idempotency_key>)
);

CREATE INDEX <worker>_units_lease_queue_idx
  ON <worker>_units (state, retry_after, created_at)
  WHERE state = 'pending';
```

Key rules:

- **`CHECK (state IN ...)`** over Postgres ENUM. ENUMs are painful to alter.
- **Lease-coherence CHECK** makes invalid combinations (pending + worker_id set) impossible at the schema layer.
- **Partial index** on `WHERE state = 'pending'` so the queue scan is cheap even under millions of completed rows.
- **Idempotency key UNIQUE** catches double-submission at the schema layer even if the app retries wrongly.

### Lease

Model on `lib/batch-worker.ts` → `leaseNextPage`. Shape:

```ts
export async function leaseNext<Unit>(
  workerId: string,
  opts: { leaseDurationMs?: number } = {},
): Promise<Lease<Unit> | null> {
  const pg = await getPgClient();
  const leaseDurationMs = opts.leaseDurationMs ?? DEFAULT_LEASE_MS;

  // FOR UPDATE SKIP LOCKED so concurrent workers get disjoint rows.
  // The WHERE filter includes retry_after to honour backoff windows.
  const { rows } = await pg.query(
    `
    WITH candidate AS (
      SELECT id FROM <worker>_units
      WHERE state = 'pending'
        AND (retry_after IS NULL OR retry_after <= now())
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE <worker>_units
    SET state = 'leased',
        worker_id = $1,
        lease_expires_at = now() + ($2 || ' milliseconds')::interval,
        updated_at = now()
    WHERE id IN (SELECT id FROM candidate)
    RETURNING id, job_id, slot_index, <idempotency_key>, retry_count
    `,
    [workerId, leaseDurationMs],
  );

  return rows[0] ?? null;
}
```

`FOR UPDATE SKIP LOCKED` is the correctness primitive. Without it, concurrent workers serialize on the queue scan and throughput flatlines.

### Heartbeat

```ts
export async function heartbeat(
  unitId: string,
  workerId: string,
  opts: { leaseDurationMs?: number } = {},
): Promise<boolean> {
  const { rowCount } = await pg.query(
    `UPDATE <worker>_units
     SET lease_expires_at = now() + ($1 || ' milliseconds')::interval
     WHERE id = $2 AND worker_id = $3 AND state IN ('leased','processing')`,
    [opts.leaseDurationMs ?? DEFAULT_LEASE_MS, unitId, workerId],
  );
  return rowCount === 1;
}
```

Returns `false` when the lease has been reaped and relet to a different worker. Caller sees `false` → stop doing work + let the new worker handle it.

### Reaper

```ts
export async function reapExpiredLeases(): Promise<{ reapedCount: number }> {
  const { rowCount } = await pg.query(
    `UPDATE <worker>_units
     SET state = 'pending',
         worker_id = NULL,
         lease_expires_at = NULL,
         retry_count = retry_count + 1
     WHERE state IN ('leased','processing')
       AND lease_expires_at < now()`,
  );
  return { reapedCount: rowCount ?? 0 };
}
```

Idempotent: re-running it on a table with no expired leases affects zero rows. Two reapers racing each reap a disjoint subset — the UPDATE is atomic per row.

### Process loop

Model on `processSlotAnthropic`. Each stage:

1. State transition with lease-coherence filter (`WHERE id=$1 AND worker_id=$2 AND lease_expires_at > now()`). Assert 1 row — else lease was lost.
2. Cancellation check. `SELECT cancel_requested_at FROM <worker>_jobs`. If set: state → `skipped`, event log, return.
3. External call (if any). Use pre-stamped idempotency key. Wrap in try/catch, classify as retryable / non-retryable.
4. **Event log first**: `INSERT INTO <worker>_events`.
5. State column update.
6. Terminal transitions: job-aggregation UPDATE with top-branch CASE preserving terminal statuses.

## Required tests

See [`concurrency-test-harness.md`](./concurrency-test-harness.md) for the 4-worker pattern. Minimum per new worker:

1. **Lease atomicity**: 4 workers leasing 20 units produces 20 distinct processings.
2. **Reaper idempotency**: two reapers running concurrently leave the same post-state.
3. **Heartbeat refuses stolen leases**: worker A leases → reaper resets → worker B leases → worker A heartbeat returns false.
4. **Crash recovery at every state**: tests per intermediate state (`leased` / `processing` / pre-external-call / mid-external-call) — crash, reap, reprocess, terminal. Idempotency key reused throughout.
5. **Retry budget**: retryable failures defer via `retry_after`; N attempts, then terminal.
6. **Retryable vs non-retryable classification**: the non-retryable code goes terminal on first attempt.
7. **Cancellation**: pending → skipped; in-flight completes without flipping job status.
8. **Cost reconciliation**: sum from events equals the slot's cost_cents field.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape: `feat(<milestone-or-worker>): <worker-name> worker core`.

The "Risks identified and mitigated" section MUST cover every invariant above:

- Atomic lease (constraint or `SKIP LOCKED`?).
- Heartbeat strategy (which stages heartbeat, which don't).
- Reaper idempotency (test explicitly).
- Idempotency key scheme (what function derives it; why two of those collide never).
- Event-log-first (point to the code that writes events before the state update).
- Top-branch CASE on job aggregation.

## Known pitfalls

- **No `SKIP LOCKED`**: queue scan serializes. Fleet of workers collapses to one. Happened in an early M3 draft.
- **Fresh idempotency key per retry**: double bills. Pre-compute at insert; never at process time.
- **State column flipped before event log**: a crash between the two leaves the event log silent about work that was done. Reconciliation breaks. Always event-first.
- **Missing lease-coherence filter on UPDATEs**: a reaped + relet lease lets the first worker's late write clobber the second's. Every state UPDATE includes `worker_id = $workerId AND lease_expires_at > now()`.
- **Cascading trigger that updates the same table**: deadlock under contention. Triggers that write to the unit table while a worker is processing that unit conflict. Use app-level bumps.
- **Reaper that doesn't bump `retry_count`**: a single crashing worker can hold the queue hostage indefinitely. Count + cap both are required.
- **`generation_events` retention not planned**: event-log-first means unbounded growth. Plan the retention slice (deferred to M7 in Opollo; don't forget when the same question surfaces in a new worker).

## Pointers

- Canonical instance: the M3 batch worker. Files: `lib/batch-worker.ts`, `lib/batch-publisher.ts`, `lib/quality-gates.ts`, `lib/anthropic-call.ts`, `supabase/migrations/0007_m3_1_batch_schema.sql`, `supabase/migrations/0009_m3_7_retry_after.sql`.
- Tests: `lib/__tests__/batch-worker*.test.ts` — 8 files, all the invariants pinned.
- Related: [`concurrency-test-harness.md`](./concurrency-test-harness.md), [`new-batch-worker-stage.md`](./new-batch-worker-stage.md), [`new-migration.md`](./new-migration.md).
