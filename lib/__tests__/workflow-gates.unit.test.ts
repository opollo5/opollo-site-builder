import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for lib/platform/workflow/index.ts
//
// All Supabase calls are mocked. We test:
//   - getGates: returns 3 disabled defaults for a company with no DB rows
//   - getEnabledGate: returns null when the gate is disabled (not found)
//   - upsertGates: calls the DB in the correct order (upsert → delete → insert)
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { getGates, getEnabledGate, upsertGates } from "@/lib/platform/workflow";

const COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001";

// ---------------------------------------------------------------------------
// Helper: build a chainable Supabase builder mock.
// ---------------------------------------------------------------------------

function makeSelectChain(finalResult: { data: unknown; error: null | { message: string } }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminal = { ...finalResult };
  const resolved = Promise.resolve(terminal);

  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  // .in() is the last call in the approver query — must return a thenable.
  chain.in = vi.fn().mockReturnValue(resolved);
  chain.order = vi.fn().mockReturnValue(terminal);
  chain.maybeSingle = vi.fn().mockResolvedValue(terminal);
  chain.single = vi.fn().mockResolvedValue(terminal);
  return chain;
}

function makeUpsertChain(finalResult: { data: unknown; error: null | { message: string } }) {
  const selectResult = finalResult;
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.upsert = vi.fn().mockReturnValue(chain);
  chain.select = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(selectResult);
  return chain;
}

function makeDeleteChain(finalResult: { error: null | { message: string } }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockResolvedValue(finalResult);
  return chain;
}

function makeInsertChain(finalResult: { error: null | { message: string } }) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.insert = vi.fn().mockResolvedValue(finalResult);
  return chain;
}

// ---------------------------------------------------------------------------
// getGates — 3 disabled defaults when no DB rows exist
// ---------------------------------------------------------------------------

describe("getGates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns three disabled defaults when company has no gate rows", async () => {
    // First from() call → company_workflow_gates (returns empty array)
    const gateChain = makeSelectChain({ data: [], error: null });

    mockFrom.mockReturnValue(gateChain);

    const result = await getGates(COMPANY_ID);

    expect(result).toHaveLength(3);
    for (const gate of result) {
      expect(gate.enabled).toBe(false);
      expect(gate.approvers).toEqual([]);
      expect(gate.companyId).toBe(COMPANY_ID);
    }

    const types = result.map((g) => g.gateType).sort();
    expect(types).toEqual(["copy_review", "final_signoff", "image_review"]);
  });

  it("returns three disabled defaults on a DB error", async () => {
    const errorChain = makeSelectChain({ data: null, error: { message: "connection refused" } });
    mockFrom.mockReturnValue(errorChain);

    const result = await getGates(COMPANY_ID);

    expect(result).toHaveLength(3);
    expect(result.every((g) => !g.enabled)).toBe(true);
  });

  it("maps DB rows to camelCase domain types", async () => {
    const gateRow = {
      id: "gate-uuid-1",
      company_id: COMPANY_ID,
      gate_type: "copy_review",
      enabled: true,
      pass_rule: "all_must",
      timeout_days: 7,
      auto_schedule: false,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const approverRow = {
      id: "approver-uuid-1",
      gate_id: "gate-uuid-1",
      platform_user_id: "user-uuid-1",
      external_email: null,
      created_at: "2026-01-01T00:00:00Z",
    };

    // call 1: company_workflow_gates select
    const gateSelectChain = makeSelectChain({ data: [gateRow], error: null });
    // call 2: company_workflow_gate_approvers select
    const approverSelectChain = makeSelectChain({ data: [approverRow], error: null });

    mockFrom
      .mockReturnValueOnce(gateSelectChain)
      .mockReturnValueOnce(approverSelectChain);

    const result = await getGates(COMPANY_ID);

    const copyGate = result.find((g) => g.gateType === "copy_review");
    expect(copyGate).toBeDefined();
    expect(copyGate?.enabled).toBe(true);
    expect(copyGate?.passRule).toBe("all_must");
    expect(copyGate?.timeoutDays).toBe(7);
    expect(copyGate?.autoSchedule).toBe(false);
    expect(copyGate?.approvers).toHaveLength(1);
    expect(copyGate?.approvers[0].platformUserId).toBe("user-uuid-1");
  });
});

// ---------------------------------------------------------------------------
// getEnabledGate — returns null when gate is not found or disabled
// ---------------------------------------------------------------------------

describe("getEnabledGate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no enabled gate exists", async () => {
    const chain = makeSelectChain({ data: null, error: null });
    mockFrom.mockReturnValue(chain);

    const result = await getEnabledGate(COMPANY_ID, "copy_review");
    expect(result).toBeNull();
  });

  it("returns null on DB error", async () => {
    const chain = makeSelectChain({ data: null, error: { message: "timeout" } });
    mockFrom.mockReturnValue(chain);

    const result = await getEnabledGate(COMPANY_ID, "image_review");
    expect(result).toBeNull();
  });

  it("returns the gate with approvers when found and enabled", async () => {
    const gateRow = {
      id: "gate-uuid-2",
      company_id: COMPANY_ID,
      gate_type: "final_signoff",
      enabled: true,
      pass_rule: "any_one",
      timeout_days: 14,
      auto_schedule: true,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    const gateChain = makeSelectChain({ data: gateRow, error: null });
    const approverChain = makeSelectChain({ data: [], error: null });

    mockFrom
      .mockReturnValueOnce(gateChain)
      .mockReturnValueOnce(approverChain);

    const result = await getEnabledGate(COMPANY_ID, "final_signoff");

    expect(result).not.toBeNull();
    expect(result?.gateType).toBe("final_signoff");
    expect(result?.enabled).toBe(true);
    expect(result?.approvers).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// upsertGates — verifies correct query sequence: upsert → delete → insert
// ---------------------------------------------------------------------------

describe("upsertGates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls upsert, delete, and insert in order for each gate", async () => {
    const upsertedGate = { id: "gate-uuid-3" };

    const upsertChain = makeUpsertChain({ data: upsertedGate, error: null });
    const deleteChain = makeDeleteChain({ error: null });
    const insertChain = makeInsertChain({ error: null });

    mockFrom
      .mockReturnValueOnce(upsertChain)  // company_workflow_gates upsert
      .mockReturnValueOnce(deleteChain)  // company_workflow_gate_approvers delete
      .mockReturnValueOnce(insertChain); // company_workflow_gate_approvers insert

    await expect(
      upsertGates(
        COMPANY_ID,
        [
          {
            gateType: "copy_review",
            enabled: true,
            passRule: "any_one",
            timeoutDays: 7,
            autoSchedule: true,
            approvers: [{ externalEmail: "reviewer@example.com" }],
          },
        ],
        "user-uuid-actor",
      ),
    ).resolves.toBeUndefined();

    expect(upsertChain.upsert).toHaveBeenCalledOnce();
    expect(deleteChain.delete).toHaveBeenCalledOnce();
    expect(insertChain.insert).toHaveBeenCalledOnce();
  });

  it("skips the insert step when no approvers are supplied", async () => {
    const upsertedGate = { id: "gate-uuid-4" };

    const upsertChain = makeUpsertChain({ data: upsertedGate, error: null });
    const deleteChain = makeDeleteChain({ error: null });
    const insertChain = makeInsertChain({ error: null });

    mockFrom
      .mockReturnValueOnce(upsertChain)
      .mockReturnValueOnce(deleteChain);
    // insert should NOT be called — we don't even set up a third mock.

    await expect(
      upsertGates(
        COMPANY_ID,
        [
          {
            gateType: "image_review",
            enabled: false,
            passRule: "all_must",
            timeoutDays: 14,
            autoSchedule: false,
            approvers: [],
          },
        ],
        "user-uuid-actor",
      ),
    ).resolves.toBeUndefined();

    expect(upsertChain.upsert).toHaveBeenCalledOnce();
    expect(deleteChain.delete).toHaveBeenCalledOnce();
    expect(insertChain.insert).not.toHaveBeenCalled();
  });

  it("throws when upsert returns an error", async () => {
    const upsertChain = makeUpsertChain({ data: null, error: { message: "unique violation" } });
    mockFrom.mockReturnValueOnce(upsertChain);

    await expect(
      upsertGates(
        COMPANY_ID,
        [
          {
            gateType: "final_signoff",
            enabled: true,
            passRule: "any_one",
            timeoutDays: 14,
            autoSchedule: true,
            approvers: [],
          },
        ],
        "user-uuid-actor",
      ),
    ).rejects.toThrow("Failed to upsert gate final_signoff");
  });

  it("throws on duplicate gate_types in input", async () => {
    await expect(
      upsertGates(
        COMPANY_ID,
        [
          { gateType: "copy_review", enabled: true, passRule: "any_one", timeoutDays: 7, autoSchedule: true, approvers: [] },
          { gateType: "copy_review", enabled: false, passRule: "all_must", timeoutDays: 14, autoSchedule: false, approvers: [] },
        ],
        "user-uuid-actor",
      ),
    ).rejects.toThrow("Duplicate gate_type");
  });
});
