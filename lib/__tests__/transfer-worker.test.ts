import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import {
  DEFAULT_LEASE_MS,
  heartbeat,
  leaseNextTransferItem,
  processTransferItemDummy,
  reapExpiredLeases,
} from "@/lib/transfer-worker";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-2 transfer-worker concurrency tests.
//
// Mirrors the M3-3 worker tests (lib/__tests__/batch-worker.test.ts).
// Pins the three invariants the rest of M4 depends on:
//
//   1. leaseNextTransferItem is atomic per item under concurrent workers.
//      Run 4 workers against 20 items; every item is processed exactly
//      once, no item is leased twice.
//
//   2. reapExpiredLeases is idempotent under races. Seed expired leases;
//      two reapers run concurrently; the end state is "all expired
//      items back to pending" with no duplicate events.
//
//   3. heartbeat refuses writes from a worker that no longer owns the
//      lease. Lease → reaper resets → relet to worker B → worker A's
//      heartbeat returns false.
//
// Plus crash recovery at every intermediate state (leased / uploading
// / captioning) and the dummy processor's happy path.
// ---------------------------------------------------------------------------

function dbUrl(): string {
  return (
    process.env.SUPABASE_DB_URL ??
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
  );
}

async function newPgClient(): Promise<Client> {
  const c = new Client({ connectionString: dbUrl() });
  await c.connect();
  return c;
}

// Seed a cloudflare_ingest job with N pending items. Returns the job
// id + the item ids in slot order.
async function seedJobWithItems(slots: number): Promise<{
  jobId: string;
  itemIds: string[];
}> {
  const svc = getServiceRoleClient();
  const { data: job } = await svc
    .from("transfer_jobs")
    .insert({
      type: "cloudflare_ingest",
      requested_count: slots,
      idempotency_key: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    })
    .select("id")
    .single();
  if (!job) throw new Error("seedJobWithItems: job insert failed");

  const rows = Array.from({ length: slots }, (_unused, i) => ({
    transfer_job_id: job.id,
    slot_index: i,
    cloudflare_idempotency_key: `cf-${job.id}-${i}`,
    anthropic_idempotency_key: `an-${job.id}-${i}`,
    source_url: `https://source.test/${i}.jpg`,
  }));

  const { data, error } = await svc
    .from("transfer_job_items")
    .insert(rows)
    .select("id, slot_index")
    .order("slot_index", { ascending: true });
  if (error || !data) {
    throw new Error(`seedJobWithItems: items insert failed: ${error?.message}`);
  }
  return { jobId: job.id, itemIds: data.map((r) => r.id as string) };
}

const openClients: Client[] = [];

afterAll(async () => {
  for (const c of openClients) {
    try {
      await c.end();
    } catch {
      // ignore
    }
  }
});

// ---------------------------------------------------------------------------
// leaseNextTransferItem — single worker
// ---------------------------------------------------------------------------

describe("leaseNextTransferItem — single worker", () => {
  it("leases the oldest pending item and returns its contract", async () => {
    const { jobId } = await seedJobWithItems(3);

    const leased = await leaseNextTransferItem("worker-1");
    expect(leased).not.toBeNull();
    if (!leased) return;
    expect(leased.transfer_job_id).toBe(jobId);
    expect(leased.slot_index).toBe(0);
    expect(leased.retry_count).toBe(1); // bumped on acquisition
    expect(leased.cloudflare_idempotency_key).toBe(`cf-${jobId}-0`);
    expect(leased.anthropic_idempotency_key).toBe(`an-${jobId}-0`);
    expect(leased.source_url).toBe("https://source.test/0.jpg");

    // DB row reflects the lease.
    const svc = getServiceRoleClient();
    const { data: row } = await svc
      .from("transfer_job_items")
      .select("state, worker_id, lease_expires_at, retry_count")
      .eq("id", leased.id)
      .single();
    expect(row?.state).toBe("leased");
    expect(row?.worker_id).toBe("worker-1");
    expect(row?.retry_count).toBe(1);
    expect(
      new Date(row!.lease_expires_at as string).getTime(),
    ).toBeGreaterThan(Date.now());
  });

  it("returns null when nothing is leasable", async () => {
    const leased = await leaseNextTransferItem("worker-lonely");
    expect(leased).toBeNull();
  });

  it("skips pending items whose retry_after is in the future", async () => {
    const svc = getServiceRoleClient();
    const { jobId } = await seedJobWithItems(1);
    // Defer the one item 10s into the future.
    await svc
      .from("transfer_job_items")
      .update({
        retry_after: new Date(Date.now() + 10_000).toISOString(),
      })
      .eq("transfer_job_id", jobId);

    const leased = await leaseNextTransferItem("worker-x");
    expect(leased).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// leaseNextTransferItem — 4 workers × 20 items, exactly-once processing
// ---------------------------------------------------------------------------

describe("leaseNextTransferItem — concurrent workers", () => {
  it("four workers leasing twenty items produce exactly twenty distinct processings", async () => {
    await seedJobWithItems(20);

    // One pg.Client per worker so they hit distinct transactions.
    const workers = await Promise.all(
      [0, 1, 2, 3].map(async (i) => {
        const c = await newPgClient();
        openClients.push(c);
        return { id: `worker-${i}`, client: c };
      }),
    );

    async function runWorker(worker: {
      id: string;
      client: Client;
    }): Promise<string[]> {
      const processed: string[] = [];
      while (true) {
        const item = await leaseNextTransferItem(worker.id, {
          client: worker.client,
        });
        if (!item) return processed;
        await processTransferItemDummy(item.id, worker.id, {
          client: worker.client,
        });
        processed.push(item.id);
      }
    }

    const results = await Promise.all(workers.map(runWorker));
    const allProcessed = results.flat();

    expect(allProcessed).toHaveLength(20);
    expect(new Set(allProcessed).size).toBe(20); // no duplicate processing

    // Every item ended in 'succeeded'.
    const svc = getServiceRoleClient();
    const { data: rows } = await svc
      .from("transfer_job_items")
      .select("id, state, worker_id, lease_expires_at");
    expect(rows).toHaveLength(20);
    expect(rows!.every((r) => r.state === "succeeded")).toBe(true);
    // Terminal state: lease cleared.
    expect(rows!.every((r) => r.worker_id === null)).toBe(true);
    expect(rows!.every((r) => r.lease_expires_at === null)).toBe(true);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

describe("heartbeat", () => {
  it("extends lease_expires_at when the worker still owns the lease", async () => {
    await seedJobWithItems(1);
    const leased = await leaseNextTransferItem("worker-h", {
      leaseDurationMs: 1_000, // short so the extension is measurable
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    // Tiny wait so the original lease_expires_at has a meaningful
    // delta from the heartbeat-extended value.
    await new Promise((r) => setTimeout(r, 50));

    const ok = await heartbeat(leased.id, "worker-h", {
      leaseDurationMs: DEFAULT_LEASE_MS,
    });
    expect(ok).toBe(true);

    const svc = getServiceRoleClient();
    const { data: row } = await svc
      .from("transfer_job_items")
      .select("lease_expires_at, state")
      .eq("id", leased.id)
      .single();
    expect(row?.state).toBe("leased");
    // Post-heartbeat lease is now in the DEFAULT window.
    expect(
      new Date(row!.lease_expires_at as string).getTime() - Date.now(),
    ).toBeGreaterThan(DEFAULT_LEASE_MS - 5_000);
  });

  it("returns false when the lease has been taken by a different worker", async () => {
    await seedJobWithItems(1);
    const leased = await leaseNextTransferItem("worker-a", {
      leaseDurationMs: 1, // expire immediately
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    // Wait past the lease window, reap, then worker-b leases.
    await new Promise((r) => setTimeout(r, 50));
    const { reapedCount } = await reapExpiredLeases();
    expect(reapedCount).toBe(1);
    const reLeased = await leaseNextTransferItem("worker-b");
    expect(reLeased?.id).toBe(leased.id);

    const ok = await heartbeat(leased.id, "worker-a");
    expect(ok).toBe(false); // worker-a no longer owns
  });
});

// ---------------------------------------------------------------------------
// reapExpiredLeases
// ---------------------------------------------------------------------------

describe("reapExpiredLeases", () => {
  it("resets an expired leased item back to pending + emits audit event", async () => {
    await seedJobWithItems(1);
    const leased = await leaseNextTransferItem("worker-r", {
      leaseDurationMs: 1,
    });
    expect(leased).not.toBeNull();
    if (!leased) return;

    await new Promise((r) => setTimeout(r, 50));

    const { reapedCount } = await reapExpiredLeases();
    expect(reapedCount).toBe(1);

    const svc = getServiceRoleClient();
    const { data: row } = await svc
      .from("transfer_job_items")
      .select("state, worker_id, lease_expires_at")
      .eq("id", leased.id)
      .single();
    expect(row?.state).toBe("pending");
    expect(row?.worker_id).toBeNull();
    expect(row?.lease_expires_at).toBeNull();

    // Audit event written.
    const { data: events } = await svc
      .from("transfer_events")
      .select("event_type, payload_jsonb")
      .eq("transfer_job_item_id", leased.id)
      .order("created_at", { ascending: true });
    const reapedEvents = (events ?? []).filter(
      (e) => e.event_type === "item_reaped",
    );
    expect(reapedEvents).toHaveLength(1);
    expect(
      (reapedEvents[0]!.payload_jsonb as Record<string, unknown>)
        .previous_worker_id,
    ).toBe("worker-r");
  });

  it("two reapers in parallel don't double-reap", async () => {
    await seedJobWithItems(3);
    // Lease all three with short expiry so they all become eligible.
    for (const id of ["w-1", "w-2", "w-3"]) {
      const item = await leaseNextTransferItem(id, { leaseDurationMs: 1 });
      expect(item).not.toBeNull();
    }
    await new Promise((r) => setTimeout(r, 50));

    const [a, b] = await Promise.all([
      reapExpiredLeases(),
      reapExpiredLeases(),
    ]);
    // Combined reaped count is exactly 3; neither reaper double-counts.
    expect(a.reapedCount + b.reapedCount).toBe(3);

    // Every item is pending again; no row is still in 'leased'.
    const svc = getServiceRoleClient();
    const { data: rows } = await svc
      .from("transfer_job_items")
      .select("state");
    expect(rows!.every((r) => r.state === "pending")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery
// ---------------------------------------------------------------------------

describe("crash recovery", () => {
  // Parameterized: for each intermediate state a dummy crash might
  // leave an item in, assert that the reaper resets it and a fresh
  // processor run drives it to succeeded.
  const INTERMEDIATE_STATES = ["leased", "uploading", "captioning"] as const;

  for (const intermediate of INTERMEDIATE_STATES) {
    it(`reaps + re-processes an item stuck in state='${intermediate}'`, async () => {
      const { itemIds } = await seedJobWithItems(1);
      const itemId = itemIds[0]!;

      // Force the item into the intermediate state with an expired
      // lease — the shape a crashed worker would leave behind.
      const svc = getServiceRoleClient();
      await svc
        .from("transfer_job_items")
        .update({
          state: intermediate,
          worker_id: "worker-crashed",
          lease_expires_at: new Date(Date.now() - 1_000).toISOString(),
          retry_count: 1,
        })
        .eq("id", itemId);

      // Reap resets.
      const { reapedCount } = await reapExpiredLeases();
      expect(reapedCount).toBe(1);

      // Fresh worker picks up and processes to terminal.
      const release = await leaseNextTransferItem("worker-recovered");
      expect(release?.id).toBe(itemId);
      await processTransferItemDummy(itemId, "worker-recovered");

      const { data: row } = await svc
        .from("transfer_job_items")
        .select("state, retry_count")
        .eq("id", itemId)
        .single();
      expect(row?.state).toBe("succeeded");
      // retry_count bumped once by the crashed worker's lease + once
      // by the recovery lease.
      expect(row?.retry_count).toBe(2);
    }, 20_000);
  }
});

// ---------------------------------------------------------------------------
// processTransferItemDummy job-aggregation
// ---------------------------------------------------------------------------

describe("processTransferItemDummy job aggregation", () => {
  it("flips the parent job status to 'succeeded' when the last item finishes", async () => {
    const { jobId } = await seedJobWithItems(2);

    const first = await leaseNextTransferItem("w-agg-1");
    const second = await leaseNextTransferItem("w-agg-2");
    expect(first && second).toBeTruthy();
    if (!first || !second) return;

    await processTransferItemDummy(first.id, "w-agg-1");

    // Mid-flight: the job should still be 'processing'.
    const svc = getServiceRoleClient();
    const mid = await svc
      .from("transfer_jobs")
      .select("status, succeeded_count, finished_at")
      .eq("id", jobId)
      .single();
    expect(mid.data?.status).toBe("processing");
    expect(mid.data?.succeeded_count).toBe(1);
    expect(mid.data?.finished_at).toBeNull();

    // Last item finishes.
    await processTransferItemDummy(second.id, "w-agg-2");

    const final = await svc
      .from("transfer_jobs")
      .select("status, succeeded_count, finished_at")
      .eq("id", jobId)
      .single();
    expect(final.data?.status).toBe("succeeded");
    expect(final.data?.succeeded_count).toBe(2);
    expect(final.data?.finished_at).not.toBeNull();
  });
});
