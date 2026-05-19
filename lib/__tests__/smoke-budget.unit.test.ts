import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mock node:fs so budget tests don't touch the real filesystem
// ─────────────────────────────────────────────────────────────────────────────
const { mockReadFileSync, mockWriteFileSync, mockMkdirSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
}));

// Budget file is resolved relative to import.meta.dirname, which vitest
// will evaluate. We mock fs, so reads / writes never touch disk.
import { guardBudget, recordSpend, getBudgetRemaining, resetBudget } from "@/scripts/smoke/budget";

describe("smoke budget guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: budget file doesn't exist (fresh state)
    mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    mockWriteFileSync.mockImplementation(() => undefined);
    mockMkdirSync.mockImplementation(() => undefined);
  });

  it("passes when estimated cost is within budget cap ($5)", () => {
    expect(() => guardBudget(1.50)).not.toThrow();
  });

  it("passes when estimated cost exactly equals remaining budget", () => {
    expect(() => guardBudget(5.0)).not.toThrow();
  });

  it("throws when estimated cost exceeds remaining budget", () => {
    expect(() => guardBudget(5.01)).toThrow(/Budget guard/);
  });

  it("throws when cumulative spend has reduced budget and new estimate overflows", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ cumulative_usd: 4.50, runs: [] }),
    );
    // $4.50 spent; $0.50 remaining — $0.60 estimate should fail
    expect(() => guardBudget(0.60)).toThrow(/Budget guard/);
  });

  it("passes when cumulative spend leaves enough room for the estimate", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ cumulative_usd: 4.50, runs: [] }),
    );
    // $4.50 spent; $0.50 remaining — $0.40 estimate should pass
    expect(() => guardBudget(0.40)).not.toThrow();
  });

  it("getBudgetRemaining returns 5.0 on fresh state", () => {
    expect(getBudgetRemaining()).toBe(5.0);
  });

  it("getBudgetRemaining returns reduced value after spend recorded", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ cumulative_usd: 2.00, runs: [] }),
    );
    expect(getBudgetRemaining()).toBe(3.0);
  });

  it("recordSpend writes updated cumulative total to budget file", () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ cumulative_usd: 1.00, runs: [] }),
    );

    recordSpend(0.25, "test run");

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(written) as { cumulative_usd: number; runs: unknown[] };
    expect(parsed.cumulative_usd).toBe(1.25);
    expect(parsed.runs).toHaveLength(1);
  });

  it("resetBudget writes zero state", () => {
    resetBudget();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [, written] = mockWriteFileSync.mock.calls[0] as [string, string];
    const parsed = JSON.parse(written) as { cumulative_usd: number };
    expect(parsed.cumulative_usd).toBe(0);
  });
});
