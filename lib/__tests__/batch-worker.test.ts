import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";

import {
  DEFAULT_LEASE_MS,
  heartbeat,
  leaseNextPage,
  processSlotDummy,
  reapExpiredLeases,
} from "@/lib/batch-worker";
import { createBatchJob } from "@/lib/batch-jobs";
import { createComponent } from "@/lib/components";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { getServiceRoleClient } from "@/lib/supabase";
import { createTemplate } from "@/lib/templates";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-3 — Worker core tests.
//
// Three invariants get pinned here. They are the contract the rest of
// M3 depends on; a regression here means two workers can race a slot
// and cause duplicate Anthropic bills (M3-4) or duplicate WP pages
// (M3-6).
//
//   1. leaseNextPage is atomic per slot. Run 4 workers concurrently
//      against 20 slots; every slot is processed exactly once, no
//      slot is leased twice.
//
//   2. reapExpiredLeases is idempotent under races. Seed several
//      slots with expired leases; run two reapers concurrently; end
//      state is "all expired slots back to pending" with no duplicate
//      ticks.
//
//   3. Crash recovery. A slot left in each non-terminal state (leased,
//      generating, validating, publishing) with an expired lease gets
//      reaped, re-leased, and processed to succeeded. State machine
//      is closed under crash-at-any-step.
//
// Plus heartbeat's positive + negative cases.
// ---------------------------------------------------------------------------

async function seedActiveTemplateForSite(siteId: string): Promise<string> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(`seed ds: ${ds.error.message}`);

  for (const name of ["hero-centered", "footer-default"]) {
    const c = await createComponent({
      design_system_id: ds.data.id,
      name,
      variant: null,
      category: name.split("-")[0] ?? "misc",
      html_template: `<section>${name}</section>`,
      css: ".ls-x {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!c.ok) throw new Error(`seed component: ${c.error.message}`);
  }

  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(`seed template: ${t.error.message}`);

  const activated = await activateDesignSystem(ds.data.id, 1);
  if (!activated.ok) throw new Error(`activate: ${activated.error.message}`);
  return t.data.id;
}

async function seedBatch(slots: number): Promise<string> {
  const site = await seedSite();
  const templateId = await seedActiveTemplateForSite(site.id);
  const res = await createBatchJob({
    site_id: site.id,
    template_id: templateId,
    slots: Array.from({ length: slots }, (_, i) => ({
      inputs: { slug: `slug-${i}`, topic: `t${i}` },
    })),
    idempotency_key: `k-${Date.now()}-${Math.random()}`,
    created_by: null,
  });
  if (!res.ok) throw new Error(`seedBatch: ${res.error.message}`);
  return res.data.job_id;
}

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

// ---------------------------------------------------------------------------
// leaseNextPage — single worker
// ---------------------------------------------------------------------------

describe("leaseNextPage — single worker", () => {
  it("leases the oldest pending slot and returns its contract", async () => {
    const jobId = await seedBatch(3);
    const leased = await leaseNextPage("worker-1");
    expect(leased).not.toBeNull();
    if (!leased) return;
    expect(leased.job_id).toBe(jobId);
    expect(leased.slot_index).toBe(0);
    expect(leased.attempts).toBe(1);
    expect(leased.anthropic_idempotency_key).toBe(`ant-${jobId}-0`);
    expect(leased.wp_idempotency_key).toBe(`wp-${jobId}-0`);

    // DB row reflects the lease.
    const svc = getServiceRoleClient();
    const { data: row } = await svc
      .from("generation_job_pages")
      .select("state, worker_id, lease_expires_at, attempts")
      .eq("id", leased.id)
      .single();
    expect(row?.state).toBe("leased");
    expect(row?.worker_id).toBe("worker-1");
    expect(row?.attempts).toBe(1);
    expect(new Date(row!.lease_expires_at as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("returns null when nothing is leasable", async () => {
    const leased = await leaseNextPage("worker-lonely");
    expect(leased).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// leaseNextPage — 4 workers, 20 slots, exactly-once processing
// ---------------------------------------------------------------------------

describe("leaseNextPage — concurrent workers", () => {
  it("four workers leasing twenty slots produce exactly twenty distinct processings", async () => {
    await seedBatch(20);

    const clients = await Promise.all(
      [0, 1, 2, 3].map(async () => newPgClient()),
    );

    async function runWorker(id: number, client: Client): Promise<string[]> {
      const processed: string[] = [];
      for (;;) {
        const slot = await leaseNextPage(`concurrent-${id}`, { client });
        if (!slot) break;
        await processSlotDummy(slot.id, `concurrent-${id}`, { client });
        processed.push(slot.id);
      }
      return processed;
    }

    try {
      const results = await Promise.all(
        clients.map((c, i) => runWorker(i, c)),
      );
      const allIds = results.flat();
      expect(allIds.length).toBe(20);
      // No slot processed twice.
      expect(new Set(allIds).size).toBe(20);

      const svc = getServiceRoleClient();
      const { data: succeeded } = await svc
        .from("generation_job_pages")
        .select("id, state")
        .in("id", allIds);
      expect(succeeded?.length).toBe(20);
      expect(succeeded?.every((r) => r.state === "succeeded")).toBe(true);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

describe("heartbeat", () => {
  it("extends lease_expires_at when the worker still owns the lease", async () => {
    await seedBatch(1);
    const leased = await leaseNextPage("hb-worker", {
      leaseDurationMs: 1_000,
    });
    if (!leased) throw new Error("lease failed");

    const svc = getServiceRoleClient();
    const { data: before } = await svc
      .from("generation_job_pages")
      .select("lease_expires_at")
      .eq("id", leased.id)
      .single();

    await new Promise((r) => setTimeout(r, 50));

    const ok = await heartbeat(leased.id, "hb-worker", {
      leaseDurationMs: DEFAULT_LEASE_MS,
    });
    expect(ok).toBe(true);

    const { data: after } = await svc
      .from("generation_job_pages")
      .select("lease_expires_at")
      .eq("id", leased.id)
      .single();
    expect(
      new Date(after!.lease_expires_at as string).getTime(),
    ).toBeGreaterThan(new Date(before!.lease_expires_at as string).getTime());
  });

  it("returns false when the lease has been taken by a different worker", async () => {
    await seedBatch(1);
    const leased = await leaseNextPage("hb-original");
    if (!leased) throw new Error("lease failed");

    // Simulate reaper + re-lease: forcibly set worker_id to another
    // identity without going through the full state machine.
    const svc = getServiceRoleClient();
    await svc
      .from("generation_job_pages")
      .update({ worker_id: "hb-hijacker" })
      .eq("id", leased.id);

    const ok = await heartbeat(leased.id, "hb-original");
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reapExpiredLeases
// ---------------------------------------------------------------------------

describe("reapExpiredLeases", () => {
  async function forceExpiredLease(
    slotId: string,
    state: "leased" | "generating" | "validating" | "publishing",
  ): Promise<void> {
    const svc = getServiceRoleClient();
    const { error } = await svc
      .from("generation_job_pages")
      .update({
        state,
        worker_id: "ghost",
        lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", slotId);
    if (error) throw new Error(`forceExpiredLease: ${error.message}`);
  }

  it("resets an expired leased slot back to pending", async () => {
    await seedBatch(1);
    const svc = getServiceRoleClient();
    const { data: slots } = await svc
      .from("generation_job_pages")
      .select("id")
      .limit(1);
    const slotId = slots![0]!.id as string;
    await forceExpiredLease(slotId, "leased");

    const { reapedCount } = await reapExpiredLeases();
    expect(reapedCount).toBe(1);

    const { data: after } = await svc
      .from("generation_job_pages")
      .select("state, worker_id, lease_expires_at")
      .eq("id", slotId)
      .single();
    expect(after?.state).toBe("pending");
    expect(after?.worker_id).toBeNull();
    expect(after?.lease_expires_at).toBeNull();
  });

  it("two reapers in parallel don't double-reap", async () => {
    await seedBatch(5);
    const svc = getServiceRoleClient();
    const { data: slots } = await svc
      .from("generation_job_pages")
      .select("id");
    const ids = (slots ?? []).map((r) => r.id as string);

    for (const id of ids) await forceExpiredLease(id, "generating");

    const clients = await Promise.all([newPgClient(), newPgClient()]);
    try {
      const results = await Promise.all(
        clients.map((c) => reapExpiredLeases({ client: c })),
      );
      const total = results.reduce((sum, r) => sum + r.reapedCount, 0);
      expect(total).toBe(5);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }

    const { data: after } = await svc
      .from("generation_job_pages")
      .select("state");
    expect(after?.every((r) => r.state === "pending")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Crash recovery across every non-terminal state
// ---------------------------------------------------------------------------

describe("crash recovery", () => {
  const states = [
    "leased",
    "generating",
    "validating",
    "publishing",
  ] as const;

  for (const state of states) {
    it(`a crashed worker in state='${state}' with expired lease is reaped + re-processed to succeeded`, async () => {
      await seedBatch(1);
      const svc = getServiceRoleClient();
      const { data: slots } = await svc
        .from("generation_job_pages")
        .select("id")
        .limit(1);
      const slotId = slots![0]!.id as string;

      // Plant a crashed state.
      const { error: forceErr } = await svc
        .from("generation_job_pages")
        .update({
          state,
          worker_id: "crashed-worker",
          lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
          attempts: 1,
        })
        .eq("id", slotId);
      if (forceErr) throw new Error(forceErr.message);

      // Reaper rescues it.
      const reap = await reapExpiredLeases();
      expect(reap.reapedCount).toBe(1);

      // New worker leases and finishes.
      const leased = await leaseNextPage("recovery-worker");
      expect(leased?.id).toBe(slotId);
      if (!leased) throw new Error("lease failed");
      expect(leased.attempts).toBe(2); // budget counted the prior crash
      await processSlotDummy(slotId, "recovery-worker");

      const { data: after } = await svc
        .from("generation_job_pages")
        .select("state, worker_id, finished_at")
        .eq("id", slotId)
        .single();
      expect(after?.state).toBe("succeeded");
      expect(after?.worker_id).toBeNull();
      expect(after?.finished_at).not.toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// processSlotDummy rolls succeeded_count + status on the parent job
// ---------------------------------------------------------------------------

describe("processSlotDummy job aggregation", () => {
  it("flips the parent job status to succeeded when the last slot finishes", async () => {
    const jobId = await seedBatch(2);
    const svc = getServiceRoleClient();

    // Process slot 0.
    const first = await leaseNextPage("agg-worker");
    if (!first) throw new Error("lease failed");
    await processSlotDummy(first.id, "agg-worker");

    const { data: mid } = await svc
      .from("generation_jobs")
      .select("succeeded_count, status")
      .eq("id", jobId)
      .single();
    expect(mid?.succeeded_count).toBe(1);
    expect(mid?.status).toBe("running");

    // Process slot 1.
    const second = await leaseNextPage("agg-worker");
    if (!second) throw new Error("lease failed");
    await processSlotDummy(second.id, "agg-worker");

    const { data: done } = await svc
      .from("generation_jobs")
      .select("succeeded_count, status, finished_at")
      .eq("id", jobId)
      .single();
    expect(done?.succeeded_count).toBe(2);
    expect(done?.status).toBe("succeeded");
    expect(done?.finished_at).not.toBeNull();
  });
});
