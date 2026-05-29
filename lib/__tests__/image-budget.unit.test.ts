import { describe, expect, test, vi, beforeEach } from "vitest";

// B3 — per-company image-generation budget cap.
//
// Tests the pre-flight check + spend increment logic in lib/image/budget.ts.
// Uses a chainable Supabase mock that records every from/select/upsert call
// so we can assert filter shape and patch payload.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface SupabaseCall {
  table: string;
  op: "select" | "upsert";
  filters: Record<string, unknown>;
  upsertRow?: unknown;
  upsertOpts?: unknown;
}

const calls: SupabaseCall[] = [];

const tableData: Record<string, Record<string, unknown> | null> = {
  platform_companies: null,
  image_gen_spend: null,
};

let upsertError: { message: string } | null = null;

function makeSelectChain(table: string): unknown {
  const call: SupabaseCall = { table, op: "select", filters: {} };
  const chain: Record<string, unknown> = {
    eq(field: string, value: unknown) {
      call.filters[field] = value;
      return chain;
    },
    async maybeSingle() {
      calls.push(call);
      return { data: tableData[table] ?? null, error: null };
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
        async upsert(row: unknown, opts: unknown) {
          calls.push({
            table,
            op: "upsert",
            filters: {},
            upsertRow: row,
            upsertOpts: opts,
          });
          return { error: upsertError };
        },
      };
    },
  }),
}));

import {
  checkImageGenBudget,
  incrementImageGenSpend,
  currentMonthStartIso,
  nextMonthStartIso,
  PRICE_CENTS_PER_JOB,
  NOTIFICATION_THRESHOLD_PERCENT,
} from "@/lib/image/budget";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  calls.length = 0;
  tableData.platform_companies = null;
  tableData.image_gen_spend = null;
  upsertError = null;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// checkImageGenBudget
// ---------------------------------------------------------------------------

describe("checkImageGenBudget — happy paths", () => {
  test("budget 2000 cents, no spend row → allows 100 jobs (600 cents)", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = null; // first call of the month

    const result = await checkImageGenBudget(COMPANY_ID, 100);

    expect(result.allowed).toBe(true);
    expect(result.budget_cents).toBe(2000);
    expect(result.spent_cents).toBe(0);
    expect(result.remaining_cents).toBe(2000);
    expect(result.projected_jobs).toBe(100);
    expect(result.projected_cents).toBe(600);
    expect(result.reason).toBeUndefined();
  });

  test("budget 2000, spent 1400, projecting 100 jobs ($6.00) → 600 remaining, allowed", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = { spend_cents: 1400 };

    const result = await checkImageGenBudget(COMPANY_ID, 100);

    expect(result.allowed).toBe(true);
    expect(result.remaining_cents).toBe(600);
    expect(result.projected_cents).toBe(600);
  });

  test("exact-equal: projected cents == remaining → allowed (inclusive)", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 600 };
    tableData.image_gen_spend = { spend_cents: 0 };

    const result = await checkImageGenBudget(COMPANY_ID, 100); // 600 cents exact

    expect(result.allowed).toBe(true);
    expect(result.projected_cents).toBe(600);
    expect(result.remaining_cents).toBe(600);
  });
});

describe("checkImageGenBudget — over-budget rejection", () => {
  test("over by one job → rejected, includes reason=over_budget and next_reset_at", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 50 };
    tableData.image_gen_spend = { spend_cents: 0 };

    const result = await checkImageGenBudget(COMPANY_ID, 10); // 60 cents > 50

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("over_budget");
    expect(result.projected_cents).toBe(60);
    expect(result.remaining_cents).toBe(50);
    expect(result.next_reset_at).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });

  test("the §B3 checkpoint scenario: $0.50 budget, 30 jobs ($1.80) → rejected", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 50 };
    tableData.image_gen_spend = null;

    const result = await checkImageGenBudget(COMPANY_ID, 30);

    expect(result.allowed).toBe(false);
    expect(result.projected_cents).toBe(180); // 30 × 6 cents
    expect(result.remaining_cents).toBe(50);
    expect(result.budget_cents).toBe(50);
  });

  test("budget already consumed → remaining=0, any projection rejected", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = { spend_cents: 2000 };

    const result = await checkImageGenBudget(COMPANY_ID, 1);

    expect(result.allowed).toBe(false);
    expect(result.remaining_cents).toBe(0);
  });

  test("over-spend somehow happened (race window) → remaining clamped to 0, not negative", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = { spend_cents: 2100 }; // exceeded due to concurrent completions

    const result = await checkImageGenBudget(COMPANY_ID, 1);

    expect(result.remaining_cents).toBe(0);
    expect(result.allowed).toBe(false);
  });
});

describe("checkImageGenBudget — degraded company lookup", () => {
  test("company row missing → rejected with budget_disabled, no spend leak", async () => {
    tableData.platform_companies = null;
    tableData.image_gen_spend = { spend_cents: 0 };

    const result = await checkImageGenBudget(COMPANY_ID, 1);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("budget_disabled");
    expect(result.budget_cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// incrementImageGenSpend
// ---------------------------------------------------------------------------

describe("incrementImageGenSpend", () => {
  test("first job of the month: inserts new row with PRICE_CENTS_PER_JOB", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = null;

    const result = await incrementImageGenSpend(COMPANY_ID, 1);

    expect(result).toEqual({
      spent_cents: PRICE_CENTS_PER_JOB,
      budget_cents: 2000,
      crossed_80_percent: false,
    });

    const upserts = calls.filter((c) => c.op === "upsert" && c.table === "image_gen_spend");
    expect(upserts).toHaveLength(1);
    const row = upserts[0].upsertRow as {
      company_id: string;
      month: string;
      spend_cents: number;
      notified_80_at: string | null;
    };
    expect(row.company_id).toBe(COMPANY_ID);
    expect(row.spend_cents).toBe(PRICE_CENTS_PER_JOB);
    expect(row.notified_80_at).toBeNull();
    expect((upserts[0].upsertOpts as { onConflict: string }).onConflict).toBe("company_id,month");
  });

  test("subsequent increment: adds to existing spend", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = { spend_cents: 100, notified_80_at: null };

    const result = await incrementImageGenSpend(COMPANY_ID, 1);

    expect(result?.spent_cents).toBe(106);
    expect(result?.crossed_80_percent).toBe(false);
  });

  test("80% threshold crossed for the first time → crossed_80_percent=true + notified_80_at set", async () => {
    // 80% of 2000 = 1600. Previously spent 1594; one more job (+6) → 1600.
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = { spend_cents: 1594, notified_80_at: null };

    const result = await incrementImageGenSpend(COMPANY_ID, 1);

    expect(result?.spent_cents).toBe(1600);
    expect(result?.crossed_80_percent).toBe(true);

    const row = calls.find((c) => c.op === "upsert")?.upsertRow as {
      notified_80_at: string | null;
    };
    expect(row.notified_80_at).not.toBeNull();
  });

  test("80% already notified → crossed_80_percent=false, notified_80_at preserved (truthy)", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = {
      spend_cents: 1700,
      notified_80_at: "2026-05-15T00:00:00.000Z",
    };

    const result = await incrementImageGenSpend(COMPANY_ID, 1);

    expect(result?.crossed_80_percent).toBe(false);
    const row = calls.find((c) => c.op === "upsert")?.upsertRow as {
      notified_80_at: string | null;
    };
    // notified_80_at remains set (refreshed to now() — non-null marker).
    expect(row.notified_80_at).not.toBeNull();
  });

  test("upsert error → returns null, does not throw", async () => {
    tableData.platform_companies = { monthly_image_gen_budget_cents: 2000 };
    tableData.image_gen_spend = null;
    upsertError = { message: "constraint violation" };

    const result = await incrementImageGenSpend(COMPANY_ID, 1);

    expect(result).toBeNull();
  });

  test("company missing → returns null, no upsert issued", async () => {
    tableData.platform_companies = null;

    const result = await incrementImageGenSpend(COMPANY_ID, 1);

    expect(result).toBeNull();
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

describe("month boundary helpers", () => {
  test("currentMonthStartIso returns first-of-month YYYY-MM-DD UTC", () => {
    const result = currentMonthStartIso(new Date("2026-05-29T18:30:00.000Z"));
    expect(result).toBe("2026-05-01");
  });

  test("currentMonthStartIso handles December → next is January next year", () => {
    expect(currentMonthStartIso(new Date("2026-12-15T00:00:00.000Z"))).toBe("2026-12-01");
    expect(nextMonthStartIso(new Date("2026-12-15T00:00:00.000Z"))).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  test("constants are exported and stable", () => {
    expect(PRICE_CENTS_PER_JOB).toBe(6);
    expect(NOTIFICATION_THRESHOLD_PERCENT).toBe(80);
  });
});
