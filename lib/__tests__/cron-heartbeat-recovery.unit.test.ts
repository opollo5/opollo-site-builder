import { describe, expect, test, vi, beforeEach } from "vitest";

// Tests the recovery-sweep wiring added in fix/cron-heartbeat-recovery-sweep:
//   1. recordCronRecovery() finds + resolves unresolved cron_stale rows for a
//      given jobName, safe-degrades on Supabase error.
//   2. updateHeartbeat() calls recordCronRecovery() ONLY when status='ok'.
//
// Companion to service-health-record.unit.test.ts (which mocks the entire
// supabase chain for recordHealthEvent's dedup logic). This file uses its own
// chainable mock because recordCronRecovery's UPDATE chain is deeper:
//   .update(...).eq().eq().eq().is().select()

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Chainable Supabase mock — captures (filters, terminal verb, result)
// ---------------------------------------------------------------------------

interface ChainCall {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  filters: Record<string, unknown>;
  isNull: string[];
  patch?: unknown;
  inserted?: unknown;
  terminal: "select" | "maybeSingle" | "single" | "none";
}

const calls: ChainCall[] = [];
let nextUpdateSelectResult: { data: unknown; error: unknown } = { data: [], error: null };
let nextHeartbeatMaybeSingleResult: { data: unknown; error: unknown } = {
  data: { run_count: 5 },
  error: null,
};

function makeUpdateChain(table: string, patch: unknown): unknown {
  const call: ChainCall = {
    table,
    op: "update",
    filters: {},
    isNull: [],
    patch,
    terminal: "none",
  };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      call.filters[field] = value;
      return chain;
    },
    is(field: string, value: unknown) {
      if (value === null) call.isNull.push(field);
      return chain;
    },
    neq(_field: string, _value: unknown) {
      return chain;
    },
    async select(_cols?: string) {
      call.terminal = "select";
      calls.push(call);
      return nextUpdateSelectResult;
    },
  };
  // Also handle the terminal-eq case used by updateHeartbeat (no .select()).
  // Solution: wrap chain so awaiting it (the final .eq) resolves to a result.
  const thenable: Record<string, unknown> & PromiseLike<unknown> = {
    ...chain,
    then(onfulfilled: ((v: unknown) => unknown) | null | undefined) {
      call.terminal = "none";
      calls.push(call);
      return Promise.resolve({ error: null }).then(onfulfilled ?? ((v) => v));
    },
  } as never;
  // Make .eq chainable AND awaitable.
  const eqHandler = (field: string, value: unknown): unknown => {
    call.filters[field] = value;
    return thenable;
  };
  thenable.eq = eqHandler;
  return thenable;
}

function makeSelectChain(table: string): unknown {
  const call: ChainCall = {
    table,
    op: "select",
    filters: {},
    isNull: [],
    terminal: "none",
  };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      call.filters[field] = value;
      return chain;
    },
    is(field: string, value: unknown) {
      if (value === null) call.isNull.push(field);
      return chain;
    },
    async maybeSingle() {
      call.terminal = "maybeSingle";
      calls.push(call);
      return nextHeartbeatMaybeSingleResult;
    },
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      return {
        select(_cols?: string) {
          return makeSelectChain(table);
        },
        update(patch: unknown) {
          return makeUpdateChain(table, patch);
        },
      };
    },
  }),
}));

import { recordCronRecovery } from "@/lib/platform/service-health/record";
import { updateHeartbeat } from "@/lib/platform/cron/cron-shared";
import { logger } from "@/lib/logger";

beforeEach(() => {
  calls.length = 0;
  nextUpdateSelectResult = { data: [], error: null };
  nextHeartbeatMaybeSingleResult = { data: { run_count: 5 }, error: null };
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// recordCronRecovery
// ---------------------------------------------------------------------------

describe("recordCronRecovery", () => {
  test("issues an UPDATE filtered by service+event_type+operation+resolved_at=null", async () => {
    nextUpdateSelectResult = { data: [], error: null };

    await recordCronRecovery("cleanup-cache");

    const updates = calls.filter((c) => c.op === "update" && c.table === "service_health_events");
    expect(updates).toHaveLength(1);
    const u = updates[0];
    expect(u.filters.service_name).toBe("cron");
    expect(u.filters.event_type).toBe("cron_stale");
    expect(u.filters.operation).toBe("cleanup-cache");
    expect(u.isNull).toContain("resolved_at");
    expect((u.patch as { resolved_at: string }).resolved_at).toBeDefined();
  });

  test("logs sweep info when rows were resolved", async () => {
    nextUpdateSelectResult = { data: [{ id: "row-1" }, { id: "row-2" }], error: null };

    await recordCronRecovery("escalate-approvals");

    expect(logger.info).toHaveBeenCalledWith(
      "service_health.cron_recovery_swept",
      expect.objectContaining({ jobName: "escalate-approvals", resolved_count: 2 }),
    );
  });

  test("does NOT log a sweep when zero rows resolved (steady-state, common case)", async () => {
    nextUpdateSelectResult = { data: [], error: null };

    await recordCronRecovery("publish-due");

    expect(logger.info).not.toHaveBeenCalledWith(
      "service_health.cron_recovery_swept",
      expect.anything(),
    );
  });

  test("safe-degrades on Supabase error (logs warn, does not throw)", async () => {
    nextUpdateSelectResult = { data: null, error: { message: "connection refused" } };

    await expect(recordCronRecovery("any-cron")).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "service_health.cron_recovery_failed",
      expect.objectContaining({ jobName: "any-cron" }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateHeartbeat — recovery sweep is gated on status
// ---------------------------------------------------------------------------

describe("updateHeartbeat — recovery sweep gating", () => {
  test("status='ok' triggers the recovery sweep", async () => {
    nextHeartbeatMaybeSingleResult = { data: { run_count: 10 }, error: null };
    nextUpdateSelectResult = { data: [{ id: "stale-1" }], error: null };

    await updateHeartbeat("cleanup-cache", "ok");

    // Two updates against service_health_events: zero. One update against
    // cron_heartbeats (the heartbeat itself). One update against
    // service_health_events (the recovery sweep).
    const heartbeatUpdates = calls.filter(
      (c) => c.op === "update" && c.table === "cron_heartbeats",
    );
    const recoveryUpdates = calls.filter(
      (c) => c.op === "update" && c.table === "service_health_events",
    );
    expect(heartbeatUpdates).toHaveLength(1);
    expect(recoveryUpdates).toHaveLength(1);
    expect(recoveryUpdates[0].filters.operation).toBe("cleanup-cache");
  });

  test("status='error' does NOT trigger the recovery sweep", async () => {
    nextHeartbeatMaybeSingleResult = { data: { run_count: 10 }, error: null };

    await updateHeartbeat("cleanup-cache", "error", new Error("db error"));

    const recoveryUpdates = calls.filter(
      (c) => c.op === "update" && c.table === "service_health_events",
    );
    expect(recoveryUpdates).toHaveLength(0);
  });

  test("recovery-sweep error does not break the heartbeat update", async () => {
    nextHeartbeatMaybeSingleResult = { data: { run_count: 10 }, error: null };
    nextUpdateSelectResult = { data: null, error: { message: "boom" } };

    await expect(updateHeartbeat("cleanup-cache", "ok")).resolves.toBeUndefined();

    const heartbeatUpdates = calls.filter(
      (c) => c.op === "update" && c.table === "cron_heartbeats",
    );
    expect(heartbeatUpdates).toHaveLength(1); // heartbeat still wrote
    expect(logger.warn).toHaveBeenCalledWith(
      "service_health.cron_recovery_failed",
      expect.objectContaining({ jobName: "cleanup-cache" }),
    );
  });
});
