# Pattern — Concurrency test harness

## When to use it

Asserting that N concurrent workers / writers produce the correct aggregate outcome. Canonical instances:

- M3-3 lease test: 4 workers × 20 slots → exactly 20 distinct processings.
- M3-3 reaper test: 2 reapers racing → all expired leases reset, no double-reap.
- M3-6 slug-claim test: 2 workers racing for the same slug → one wins, the other gets `SLUG_CONFLICT`.
- Idempotency-key test: two simultaneous batch-create POSTs with the same key → same job id returned, no duplicate row.

Use whenever a write-safety invariant is "under contention, X". Skipping the concurrency test and shipping the "happy path" for a contended resource is how production double-bills and double-publishes get born.

Don't use for: unit tests of pure functions, tests where "concurrency" just means sequencing of awaits (no shared mutable state).

## Required files

| File | Role |
| --- | --- |
| `lib/__tests__/<subject>-lease.test.ts` (or similar) | The test file. One describe block per invariant. |
| Usually nothing else. | The harness is the test itself + the existing `_setup.ts` TRUNCATE pattern. |

No new library. No test framework extension. Vitest + `Promise.all` is enough.

## Scaffolding

### The 4-worker lease pattern

Model on `lib/__tests__/batch-worker.test.ts`:

```ts
it("four workers leasing twenty slots produce exactly twenty distinct processings", async () => {
  const { jobId, slotIds } = await seedBatchWith20Slots();

  const results = await Promise.all(
    Array.from({ length: 4 }, (_unused, i) => runWorker(`worker-${i}`)),
  );

  async function runWorker(workerId: string) {
    const processed: string[] = [];
    // Each worker keeps leasing + processing until the queue is empty.
    while (true) {
      const slot = await leaseNextPage(workerId);
      if (!slot) return processed;
      await processSlotDummy(slot.id, workerId);
      processed.push(slot.id);
    }
  }

  const allProcessed = results.flat();
  expect(allProcessed).toHaveLength(20);
  expect(new Set(allProcessed).size).toBe(20); // every slot processed exactly once
  expect(new Set(allProcessed).size).toBe(slotIds.length);
});
```

Key moves:

- **`Promise.all` with N workers**, each running a complete lease → process loop. Workers compete for the queue; the test asserts the aggregate.
- **Assert distinct count equals input count.** `new Set(results).size === input.length` is the concurrency invariant.
- **No artificial `setTimeout` to "stagger" workers.** Let them race. That's the point.
- **No mock / stub.** Real Postgres, real `FOR UPDATE SKIP LOCKED`. Concurrency mocked out at the driver is a fiction.

### Race-condition spec shape

For "two operations race, one wins, one gets a documented error":

```ts
it("two workers racing the same slug: one wins, one gets SLUG_CONFLICT", async () => {
  const { slotA, slotB } = await seedTwoSlotsSameSlug();

  const [a, b] = await Promise.all([
    processSlotAnthropic(slotA.id, "worker-A"),
    processSlotAnthropic(slotB.id, "worker-B"),
  ]);

  // Exactly one succeeds, exactly one fails with the documented code.
  const results = [a, b].map((s) => s.state);
  const outcomes = [a, b].map((s) => s.failure_code);

  expect(results.sort()).toEqual(["failed", "succeeded"]);
  expect(outcomes.filter((c) => c === "SLUG_CONFLICT")).toHaveLength(1);
});
```

- **Assert the set of outcomes, not the order.** Which worker wins isn't deterministic — which outcome set exists is.
- **Name the failure code explicitly.** `SLUG_CONFLICT`, not `FAILED`. The test pins the operator-facing reason.

### Reaper idempotency

```ts
it("two reapers running in parallel don't double-reap", async () => {
  await seedThreeSlotsWithExpiredLeases();

  const [a, b] = await Promise.all([reapExpiredLeases(), reapExpiredLeases()]);

  // Combined reaped count equals the number of expired slots.
  // Individually each reaper handled some subset (FOR UPDATE SKIP LOCKED
  // splits the work).
  expect(a.reapedCount + b.reapedCount).toBe(3);

  const { data } = await svc.from("generation_job_pages").select("state, worker_id, lease_expires_at");
  // All three back to pending.
  expect(data!.every((r) => r.state === "pending")).toBe(true);
  expect(data!.every((r) => r.worker_id === null)).toBe(true);
});
```

The invariant isn't "reaper A handled exactly K rows" — it's "both reapers together handled all expired rows, no row was handled twice."

### Idempotency under races

```ts
it("two simultaneous POSTs with the same idempotency key return the same job id", async () => {
  const key = "idemp-test-" + Date.now();
  const body = { site_id: siteId, template_id: tmplId, slots: [ /* ... */ ] };

  const [a, b] = await Promise.all([
    createBatchJob({ idempotency_key: key, ...body }),
    createBatchJob({ idempotency_key: key, ...body }),
  ]);

  expect(a.ok && b.ok).toBe(true);
  expect(a.data.job_id).toBe(b.data.job_id); // exact same row

  const { count } = await svc.from("generation_jobs").select("*", { count: "exact", head: true }).eq("idempotency_key", key);
  expect(count).toBe(1); // one row, not two
});
```

## Required tests per new concurrent contract

When introducing a new piece of shared state or a new contention point, pin:

1. **N-way race** produces the documented aggregate. 4 workers is enough to flush most bugs; 20 is enough to rule out N-dependent ones.
2. **Winner + loser classification** — if two operations can collide, the losing operation fails with a specific error code, not a generic 500.
3. **Idempotency under re-submission** — re-running a completed operation produces the same outcome, not a new one.
4. **Concurrent cleanup / reaper** — if there's a background sweeper, it's safe against another instance of itself.
5. **Heartbeat stolen-lease rejection** — worker A's late UPDATE against a lease reaper-reset-then-relet-to-B returns `false` or fails loudly, doesn't clobber B's work.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). The "Risks identified and mitigated" section maps 1:1 onto the concurrency tests you ship — every write-safety hotspot listed has a test in the file that pins it.

## Known pitfalls

- **Tests that pass sequentially but fail under `Promise.all`.** The single-threaded happy path is not the test. Always use `Promise.all` or `Promise.allSettled` when the contract is about concurrency.
- **`await` in a loop instead of `Promise.all`.** `for (const w of workers) await w()` serializes — the whole point was to run concurrently. Use `await Promise.all(workers.map(runWorker))`.
- **Assuming order of completion.** `[a, b] = await Promise.all(...)` preserves input order, but which completed *first* is not deterministic. Assert sets, not sequences.
- **Stubbing the contention surface.** Mocking `SELECT ... FOR UPDATE SKIP LOCKED` means testing a fiction. Concurrency tests that don't hit real Postgres provide false confidence.
- **Not seeding enough rows.** Two workers on two slots can accidentally succeed even with broken locking — each worker happens to pick up a disjoint row by luck. Seed ≥ 5× the worker count.
- **TRUNCATE between tests leaves sequences.** M3 uses `RESTART IDENTITY CASCADE` in `_setup.ts`. Without restarting identity, `id` collisions across tests produce mysterious failures.
- **`persistent: true` auth users leaking.** RLS tests seed persistent auth users in `beforeAll` + rely on `cleanupTrackedAuthUsers` to sweep non-persistent ones in `beforeEach`. A broken `persistent` flag leaks state between files. See `_auth-helpers.ts`.
- **Assertion that fails 1% of the time.** That's a flake disguised as a pass. Re-run the test 10× locally before landing; if it doesn't pass every time, the invariant is wrong or the test is wrong.

## Pointers

- Canonical instances: `lib/__tests__/batch-worker.test.ts` (lease + reaper + heartbeat + crash recovery), `lib/__tests__/batch-create.test.ts` (idempotency), `lib/__tests__/batch-worker-publish.test.ts` (slug-claim race).
- Related: [`background-worker-with-write-safety.md`](./background-worker-with-write-safety.md), [`rls-policy-test-matrix.md`](./rls-policy-test-matrix.md).
