import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Supabase service-role mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import { runGenerationRunsCleanup } from "@/lib/cap/generation-runs-cleanup";

function makeDeleteChain(result: { count: number | null; error: null | { message: string } }) {
  const chain = {
    delete: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    lt: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

describe("runGenerationRunsCleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns dual-bucket counts when both deletes succeed", async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeDeleteChain({ count: 12, error: null });
      return makeDeleteChain({ count: 3, error: null });
    });

    const result = await runGenerationRunsCleanup();

    expect(result.deletedSuccessRows).toBe(12);
    expect(result.deletedErrorRows).toBe(3);
    expect(result.totalDeleted).toBe(15);
    expect(result.successCutoff).toBeDefined();
    expect(result.errorCutoff).toBeDefined();
  });

  it("success cutoff is ~365 days ago and error cutoff is ~730 days ago", async () => {
    mockFrom.mockImplementation(() => makeDeleteChain({ count: 0, error: null }));

    const before = Date.now();
    const result = await runGenerationRunsCleanup();
    const after = Date.now();

    const successMs = new Date(result.successCutoff).getTime();
    const errorMs = new Date(result.errorCutoff).getTime();

    // success cutoff within ±60s of 365 days ago
    expect(successMs).toBeGreaterThan(before - 365 * 24 * 60 * 60 * 1000 - 60_000);
    expect(successMs).toBeLessThan(after - 365 * 24 * 60 * 60 * 1000 + 60_000);

    // error cutoff within ±60s of 730 days ago
    expect(errorMs).toBeGreaterThan(before - 730 * 24 * 60 * 60 * 1000 - 60_000);
    expect(errorMs).toBeLessThan(after - 730 * 24 * 60 * 60 * 1000 + 60_000);
  });

  it("first delete queries only success status rows", async () => {
    const firstChain = makeDeleteChain({ count: 5, error: null });
    const secondChain = makeDeleteChain({ count: 2, error: null });
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      return callCount === 1 ? firstChain : secondChain;
    });

    await runGenerationRunsCleanup();

    expect(firstChain.in).toHaveBeenCalledWith("status", ["success"]);
    expect(secondChain.in).toHaveBeenCalledWith("status", ["error", "failed"]);
  });

  it("throws and logs when success delete fails", async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1)
        return makeDeleteChain({ count: null, error: { message: "db error" } });
      return makeDeleteChain({ count: 0, error: null });
    });

    await expect(runGenerationRunsCleanup()).rejects.toThrow(
      "Generation runs cleanup (success) failed: db error",
    );
  });

  it("throws and logs when error delete fails", async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeDeleteChain({ count: 0, error: null });
      return makeDeleteChain({ count: null, error: { message: "delete failed" } });
    });

    await expect(runGenerationRunsCleanup()).rejects.toThrow(
      "Generation runs cleanup (error) failed: delete failed",
    );
  });

  it("treats null count as 0", async () => {
    mockFrom.mockImplementation(() => makeDeleteChain({ count: null, error: null }));

    const result = await runGenerationRunsCleanup();

    expect(result.deletedSuccessRows).toBe(0);
    expect(result.deletedErrorRows).toBe(0);
    expect(result.totalDeleted).toBe(0);
  });
});
