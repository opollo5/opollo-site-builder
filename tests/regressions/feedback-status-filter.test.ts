// tests/regressions/feedback-status-filter.test.ts
//
// Tests for the admin feedback board status filter (backlog item 1).
// Verifies that listTickets correctly applies each filter group and that
// the "open" default only returns active statuses, not closed/deleted rows.
//
// Layer 1 — unit tests; all DB calls mocked.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock DB builder — captures the chain of filter calls and returns data.
// ---------------------------------------------------------------------------
type FilterCall = { method: string; args: unknown[] };

function makeQuerySpy(returnData: Record<string, unknown>[]) {
  const calls: FilterCall[] = [];
  const proxy: Record<string, unknown> = {};

  const chain = new Proxy(proxy, {
    get(_t, prop: string) {
      if (prop === "then") return undefined; // not a Promise
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        if (prop === "order") return Promise.resolve({ data: returnData, error: null });
        return chain;
      };
    },
  });

  return { chain, calls };
}

function makeSvc(returnData: Record<string, unknown>[]) {
  const { chain, calls } = makeQuerySpy(returnData);
  const svc = {
    from: () => ({ select: () => chain }),
    _calls: calls,
  };
  return svc;
}

async function callListTickets(opts: Parameters<typeof import("@/lib/feedback/tickets/queries").listTickets>[0]) {
  vi.resetModules();
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const svc = makeSvc([]);
  vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);
  const { listTickets } = await import("@/lib/feedback/tickets/queries");
  await listTickets(opts);
  return svc._calls;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("listTickets — filter groups", () => {
  beforeEach(() => vi.clearAllMocks());

  it('default (no filterGroup) behaves as "open" — calls is("deleted_at", null) and in("status", open statuses)', async () => {
    const calls = await callListTickets({});
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("is");
    expect(methods).toContain("in");
    const isCalls = calls.filter((c) => c.method === "is" && c.args[0] === "deleted_at");
    expect(isCalls.length).toBeGreaterThan(0);
    expect(isCalls[0].args[1]).toBeNull();
    const inCall = calls.find((c) => c.method === "in");
    expect(inCall?.args[0]).toBe("status");
    expect(inCall?.args[1]).toEqual(expect.arrayContaining(["backlog", "triaged", "in_progress"]));
    // must NOT include closed or wont_fix
    expect(inCall?.args[1]).not.toContain("closed");
    expect(inCall?.args[1]).not.toContain("wont_fix");
  });

  it('"all" — is(deleted_at, null), no status filter', async () => {
    const calls = await callListTickets({ filterGroup: "all" });
    const methods = calls.map((c) => c.method);
    const isCalls = calls.filter((c) => c.method === "is" && c.args[0] === "deleted_at");
    expect(isCalls[0].args[1]).toBeNull();
    expect(methods).not.toContain("in");
    const eqStatusCalls = calls.filter((c) => c.method === "eq" && c.args[0] === "status");
    expect(eqStatusCalls).toHaveLength(0);
  });

  it('"closed" — is(deleted_at, null), eq(status, closed)', async () => {
    const calls = await callListTickets({ filterGroup: "closed" });
    const isCalls = calls.filter((c) => c.method === "is" && c.args[0] === "deleted_at");
    expect(isCalls[0].args[1]).toBeNull();
    const eqStatus = calls.find((c) => c.method === "eq" && c.args[0] === "status");
    expect(eqStatus?.args[1]).toBe("closed");
  });

  it('"wont_fix" — is(deleted_at, null), eq(status, wont_fix)', async () => {
    const calls = await callListTickets({ filterGroup: "wont_fix" });
    const eqStatus = calls.find((c) => c.method === "eq" && c.args[0] === "status");
    expect(eqStatus?.args[1]).toBe("wont_fix");
  });

  it('"deleted" — not(deleted_at, is, null) i.e. deleted_at IS NOT NULL', async () => {
    const calls = await callListTickets({ filterGroup: "deleted" });
    const notCalls = calls.filter((c) => c.method === "not");
    expect(notCalls.some((c) => c.args[0] === "deleted_at")).toBe(true);
    // must NOT call is(deleted_at, null)
    const isCalls = calls.filter((c) => c.method === "is" && c.args[0] === "deleted_at");
    expect(isCalls).toHaveLength(0);
  });

  it('"open" does not include wont_fix or closed', async () => {
    const calls = await callListTickets({ filterGroup: "open" });
    const inCall = calls.find((c) => c.method === "in");
    const statuses = inCall?.args[1] as string[] ?? [];
    expect(statuses).not.toContain("wont_fix");
    expect(statuses).not.toContain("closed");
    expect(statuses).not.toContain("fixed");
    expect(statuses).not.toContain("verified");
  });
});
