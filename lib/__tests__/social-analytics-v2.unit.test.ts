import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// PR-15 — unit tests for V2 dual-lookup in getSocialAnalytics.
//
// Verifies that KPI counts sum V1 (social_post_master) + V2
// (social_post_drafts), and that V2 pending_approval drafts appear in
// the pendingApproval list.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

const COMPANY_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const { getServiceRoleClient } = await import("@/lib/supabase");
const { getSocialAnalytics } = await import("@/lib/platform/social/analytics");

// Builds a chainable mock that terminates with the provided value.
// Any method call returns the same proxy; awaiting resolves to terminal.
function chainable(terminal: unknown): unknown {
  // proxy is declared first so the getter closure can reference it
  let proxy: unknown;
  proxy = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop) {
      if (prop === "then") {
        // Make it a proper thenable so `await chainable(x)` → x
        return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(terminal).then(resolve, reject);
      }
      if (prop === Symbol.toPrimitive) return () => "[chainable]";
      // All method calls return the same proxy (keeps chain going)
      return (..._args: unknown[]) => proxy;
    },
  });
  return proxy;
}

// Build a mock svc that uses chainable() for each table.
// Override specific responses by specifying them in `overrides`.
function makeSvc(overrides: {
  v1PublishedCount?: number;
  v2PublishedCount?: number;
  v1ScheduledCount?: number;
  v2ScheduledCount?: number;
  v2Pending?: Array<{ id: string; content: string; created_at: string }>;
} = {}) {
  const {
    v1PublishedCount = 0,
    v2PublishedCount = 0,
    v1ScheduledCount = 0,
    v2ScheduledCount = 0,
    v2Pending = [],
  } = overrides;

  const calls: { table: string; select?: string }[] = [];

  const svc = {
    _calls: calls,
    from(table: string) {
      return {
        select(cols: string, opts?: { count?: string; head?: boolean }) {
          calls.push({ table, select: cols });
          if (opts?.count === "exact" && opts?.head) {
            // Count queries: identify by table + surrounding chain
            if (table === "social_post_master") {
              // Return a chainable that resolves with different counts
              // based on eq("state") call
              let resolvedState: string | null = null;
              const countChain = makeCountChain(
                (state: string) => {
                  resolvedState = state;
                },
                () => {
                  if (resolvedState === "published") return { count: v1PublishedCount, error: null };
                  if (resolvedState === "scheduled") return { count: v1ScheduledCount, error: null };
                  return { count: 0, error: null };
                },
              );
              return countChain;
            }
            if (table === "social_post_drafts") {
              let resolvedState: string | null = null;
              return makeCountChain(
                (state: string) => { resolvedState = state; },
                () => {
                  if (resolvedState === "published") return { count: v2PublishedCount, error: null };
                  if (resolvedState === "scheduled") return { count: v2ScheduledCount, error: null };
                  return { count: 0, error: null };
                },
              );
            }
            return chainable({ count: 1, error: null });
          }
          // Non-count selects
          if (table === "social_post_drafts") {
            // pending query
            if (cols.includes("content")) {
              return {
                eq: () => ({
                  eq: (_c: string, val: unknown) => {
                    if (val === "pending_approval") {
                      return {
                        order: () => ({ limit: async () => ({ data: v2Pending, error: null }) }),
                      };
                    }
                    return {
                      not: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
                      limit: async () => ({ data: [], error: null }),
                      gte: () => ({ order: async () => ({ data: [], error: null }) }),
                    };
                  },
                }),
              };
            }
            // default: return empty arrays for all V2 draft queries
            return chainable({ data: [], error: null });
          }
          // V1 non-count: return empty
          return chainable({ data: [], error: null });
        },
      };
    },
  };

  return svc;
}

// Build a chainable object that tracks eq("state", ...) and resolves count
function makeCountChain(
  onState: (state: string) => void,
  getResult: () => { count: number; error: null },
): unknown {
  const self = {
    eq(_col: string, val: unknown) {
      if (typeof val === "string") onState(val);
      return self;
    },
    is() {
      return Object.assign(Promise.resolve(getResult()), self);
    },
    gte() {
      return Object.assign(Promise.resolve(getResult()), self);
    },
    then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(getResult()).then(resolve, reject);
    },
  };
  return self;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getSocialAnalytics — V2 KPI merging", () => {
  it("returns VALIDATION_FAILED when companyId is empty", async () => {
    const result = await getSocialAnalytics("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("sums V1 + V2 totalPublished counts", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ v1PublishedCount: 3, v2PublishedCount: 7 }) as never,
    );
    const result = await getSocialAnalytics(COMPANY_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalPublished).toBe(10);
    }
  });

  it("sums V1 + V2 scheduledUpcoming counts", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({ v1ScheduledCount: 2, v2ScheduledCount: 3 }) as never,
    );
    const result = await getSocialAnalytics(COMPANY_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scheduledUpcoming).toBe(5);
    }
  });

  it("includes V2 pending_approval drafts in pendingApproval list", async () => {
    vi.mocked(getServiceRoleClient).mockReturnValue(
      makeSvc({
        v2Pending: [
          { id: "draft-001", content: "Hello V2", created_at: "2026-05-27T10:00:00Z" },
        ],
      }) as never,
    );
    const result = await getSocialAnalytics(COMPANY_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const v2Item = result.data.pendingApproval.find((p) => p.id === "draft-001");
      expect(v2Item).toBeDefined();
      expect(v2Item?.master_text).toBe("Hello V2");
    }
  });
});
