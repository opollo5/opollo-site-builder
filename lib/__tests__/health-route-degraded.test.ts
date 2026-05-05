import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Degraded-branch tests for GET /api/health (M15-6 #17).
//
// The happy path (both probes ok → 200) is covered in health-route.test.ts.
// This file covers:
//   - supabase probe fails → 503 degraded
//   - budget_reset_backlog probe fails → 503 degraded
//   - both probes fail → 503 degraded
//   - a probe throws → outer catch returns structured 503
// ---------------------------------------------------------------------------

const mockCheckSupabase = vi.hoisted(() => vi.fn());
const mockCheckBudgetResetBacklog = vi.hoisted(() => vi.fn());

vi.mock("@/lib/health-checks", async () => {
  const actual = await vi.importActual<typeof import("@/lib/health-checks")>(
    "@/lib/health-checks",
  );
  return {
    ...actual,
    checkSupabase: mockCheckSupabase,
    checkBudgetResetBacklog: mockCheckBudgetResetBacklog,
  };
});

import { GET } from "@/app/api/health/route";

const SUPABASE_OK = { result: "ok" as const, latency_ms: 5 };
const BACKLOG_OK = { result: "ok" as const, count: 0, sample: [], latency_ms: 8 };

beforeEach(() => {
  mockCheckSupabase.mockReset().mockResolvedValue(SUPABASE_OK);
  mockCheckBudgetResetBacklog.mockReset().mockResolvedValue(BACKLOG_OK);
});

describe("GET /api/health — degraded branches", () => {
  it("503 when supabase probe returns fail", async () => {
    mockCheckSupabase.mockResolvedValue({
      result: "fail",
      latency_ms: 12,
      error: "connection refused",
    });

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("fail");
    expect(body.checks.supabase_error).toBe("connection refused");
    expect(body.checks.budget_reset_backlog).toBe("ok");
  });

  it("503 when budget_reset_backlog probe returns fail", async () => {
    mockCheckBudgetResetBacklog.mockResolvedValue({
      result: "fail",
      count: 2,
      sample: ["site-a", "site-b"],
      latency_ms: 14,
    });

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("ok");
    expect(body.checks.budget_reset_backlog).toBe("fail");
    expect(body.checks.budget_reset_backlog_count).toBe(2);
    expect(body.checks.budget_reset_backlog_sample).toEqual(["site-a", "site-b"]);
  });

  it("503 when both probes fail", async () => {
    mockCheckSupabase.mockResolvedValue({
      result: "fail",
      latency_ms: 5,
      error: "db unreachable",
    });
    mockCheckBudgetResetBacklog.mockResolvedValue({
      result: "fail",
      count: 1,
      sample: ["site-x"],
      latency_ms: 6,
      error: "query timeout",
    });

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.supabase).toBe("fail");
    expect(body.checks.budget_reset_backlog).toBe("fail");
    expect(body.checks.budget_reset_backlog_error).toBe("query timeout");
  });

  it("503 when a probe throws — outer catch returns structured degraded body", async () => {
    mockCheckSupabase.mockRejectedValue(new Error("unexpected crash"));

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.probe_error).toBe("unexpected crash");
    // Build fields are still present even in the error path
    expect(typeof body.build.commit).toBe("string");
    expect(typeof body.timestamp).toBe("string");
  });

  it("200 when both probes return ok (sanity — mocked happy path)", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.supabase).toBe("ok");
    expect(body.checks.budget_reset_backlog).toBe("ok");
  });
});
