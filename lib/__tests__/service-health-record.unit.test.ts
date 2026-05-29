import { describe, expect, test, vi, beforeEach } from "vitest";

// Tests the REAL recordHealthEvent dedup logic (other tests in
// service-health.unit.test.ts mock the entire record module, so we need a
// separate file to exercise it).

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// We control the Supabase client fully — every call is a mock we record.
const supabaseCalls: Array<{ table: string; op: string; payload: unknown }> = [];

interface QueryState {
  filters: Record<string, unknown>;
  isNull: string[];
  notNull: string[];
  gte: Record<string, string>;
  orderBy: string | null;
  limitVal: number | null;
}

let nextMaybeSingle: { data: unknown; error: unknown } = { data: null, error: null };

function makeChain(table: string): unknown {
  const state: QueryState = {
    filters: {},
    isNull: [],
    notNull: [],
    gte: {},
    orderBy: null,
    limitVal: null,
  };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      state.filters[field] = value;
      return chain;
    },
    is(field: string, value: unknown) {
      if (value === null) state.isNull.push(field);
      return chain;
    },
    gte(field: string, value: string) {
      state.gte[field] = value;
      return chain;
    },
    order(field: string, _opts: unknown) {
      state.orderBy = field;
      return chain;
    },
    limit(n: number) {
      state.limitVal = n;
      return chain;
    },
    async maybeSingle() {
      supabaseCalls.push({ table, op: "select", payload: state });
      return nextMaybeSingle;
    },
  };
  return chain;
}

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      return {
        select() {
          return makeChain(table);
        },
        update(patch: unknown) {
          return {
            async eq(field: string, value: unknown) {
              supabaseCalls.push({
                table,
                op: "update",
                payload: { patch, where: { [field]: value } },
              });
              return { error: null };
            },
          };
        },
        async insert(row: unknown) {
          supabaseCalls.push({ table, op: "insert", payload: row });
          return { error: null };
        },
      };
    },
  }),
}));

import { recordHealthEvent } from "@/lib/platform/service-health/record";

beforeEach(() => {
  supabaseCalls.length = 0;
  nextMaybeSingle = { data: null, error: null };
});

// ---------------------------------------------------------------------------
// Dedup behaviour — latched event types (cron_stale)
//
// Regression: pre-fix, recordHealthEvent's dedup query did not filter by
// operation, so different stale crons collided on the same row and
// overwrote each other's operation field. It also used a 5-min window
// regardless of event type, so a heartbeat-check fire every 5 min produced
// ~12 unresolved rows per stale cron per hour (one per detector run after
// the window expired). Multiply by N stale crons → email-spam from the
// 30-min notification cooldown.
// ---------------------------------------------------------------------------

describe("recordHealthEvent — cron_stale latched dedup", () => {
  test("first detection inserts a new row", async () => {
    nextMaybeSingle = { data: null, error: null };

    await recordHealthEvent({
      serviceName: "cron",
      operation: "cleanup-cache",
      eventType: "cron_stale",
      severity: "warning",
      details: { jobName: "cleanup-cache" },
    });

    const inserts = supabaseCalls.filter((c) => c.op === "insert");
    const updates = supabaseCalls.filter((c) => c.op === "update");
    expect(inserts).toHaveLength(1);
    expect(updates).toHaveLength(0);
    expect((inserts[0].payload as { operation: string }).operation).toBe("cleanup-cache");
  });

  test("second detection of the SAME cron updates existing row (not insert)", async () => {
    nextMaybeSingle = { data: { id: "row-1", occurrence_count: 1 }, error: null };

    await recordHealthEvent({
      serviceName: "cron",
      operation: "cleanup-cache",
      eventType: "cron_stale",
      severity: "warning",
      details: { jobName: "cleanup-cache" },
    });

    const inserts = supabaseCalls.filter((c) => c.op === "insert");
    const updates = supabaseCalls.filter((c) => c.op === "update");
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as { patch: { occurrence_count: number } }).patch.occurrence_count).toBe(2);
  });

  test("cron_stale dedup query filters by operation (so different crons get separate rows)", async () => {
    nextMaybeSingle = { data: null, error: null };

    await recordHealthEvent({
      serviceName: "cron",
      operation: "health-digest",
      eventType: "cron_stale",
      severity: "warning",
      details: { jobName: "health-digest" },
    });

    // The select chain captured the filter state. Verify operation was applied.
    const selects = supabaseCalls.filter((c) => c.op === "select");
    expect(selects).toHaveLength(1);
    const state = selects[0].payload as QueryState;
    expect(state.filters.operation).toBe("health-digest");
    expect(state.filters.service_name).toBe("cron");
    expect(state.filters.event_type).toBe("cron_stale");
    expect(state.isNull).toContain("resolved_at");
    // Latched event type → NO time-window filter on last_seen_at.
    expect(state.gte.last_seen_at).toBeUndefined();
  });

  test("non-latched event types KEEP the 5-min aggregation window", async () => {
    nextMaybeSingle = { data: null, error: null };

    await recordHealthEvent({
      serviceName: "bundle.social",
      operation: "publish",
      eventType: "service_5xx",
      severity: "warning",
      details: {},
    });

    const selects = supabaseCalls.filter((c) => c.op === "select");
    const state = selects[0].payload as QueryState;
    // Bursty event type → time-window filter applied.
    expect(state.gte.last_seen_at).toBeDefined();
    expect(state.filters.operation).toBe("publish");
  });

  test("undefined operation matches IS NULL (service-level events)", async () => {
    nextMaybeSingle = { data: null, error: null };

    await recordHealthEvent({
      serviceName: "sendgrid",
      // no operation
      eventType: "service_5xx",
      severity: "critical",
      details: {},
    });

    const selects = supabaseCalls.filter((c) => c.op === "select");
    const state = selects[0].payload as QueryState;
    expect(state.isNull).toContain("operation");
    expect(state.isNull).toContain("resolved_at");
  });
});
