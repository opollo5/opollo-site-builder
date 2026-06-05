// tests/regressions/feedback-company-names.test.ts
//
// Backlog item 4: company name on the admin board.
// Verifies resolveCompanyNames skips the Opollo-internal sentinel and
// correctly maps external company IDs to names.
//
// Layer 1 — unit tests; DB mocked.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

const OPOLLO_SENTINEL = "00000000-0000-0000-0000-000000000001";
const EXTERNAL_A = "aaaaaaaa-0000-0000-0000-000000000001";
const EXTERNAL_B = "bbbbbbbb-0000-0000-0000-000000000001";

async function callResolveCompanyNames(companyIds: string[]) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const inFn = vi.fn(() => ({
    data: [
      { id: EXTERNAL_A, name: "Acme Corp" },
      { id: EXTERNAL_B, name: "Beta Ltd" },
    ],
    error: null,
  }));
  vi.mocked(getServiceRoleClient).mockReturnValue({
    from: () => ({ select: () => ({ in: inFn }) }),
  } as never);

  vi.resetModules();
  const { resolveCompanyNames } = await import("@/lib/feedback/tickets/queries");
  const result = await resolveCompanyNames(companyIds);
  return { result, inFn };
}

describe("resolveCompanyNames", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty map when all IDs are the Opollo sentinel", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue({} as never);
    vi.resetModules();
    const { resolveCompanyNames } = await import("@/lib/feedback/tickets/queries");
    const result = await resolveCompanyNames([OPOLLO_SENTINEL, OPOLLO_SENTINEL]);
    expect(result.size).toBe(0);
  });

  it("returns empty map for empty input", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue({} as never);
    vi.resetModules();
    const { resolveCompanyNames } = await import("@/lib/feedback/tickets/queries");
    const result = await resolveCompanyNames([]);
    expect(result.size).toBe(0);
  });

  it("resolves external company IDs to names", async () => {
    const { result } = await callResolveCompanyNames([EXTERNAL_A, EXTERNAL_B]);
    expect(result.get(EXTERNAL_A)).toBe("Acme Corp");
    expect(result.get(EXTERNAL_B)).toBe("Beta Ltd");
  });

  it("filters out the Opollo sentinel before querying the DB", async () => {
    const { result, inFn } = await callResolveCompanyNames([OPOLLO_SENTINEL, EXTERNAL_A]);
    // Sentinel must not appear in the DB query
    const queriedIds = ((inFn.mock.calls[0] as unknown[])?.[1] ?? []) as string[];
    expect(queriedIds).not.toContain(OPOLLO_SENTINEL);
    expect(queriedIds).toContain(EXTERNAL_A);
    // Sentinel not in result
    expect(result.has(OPOLLO_SENTINEL)).toBe(false);
    expect(result.get(EXTERNAL_A)).toBe("Acme Corp");
  });

  it("deduplicates repeated IDs before querying", async () => {
    const { inFn } = await callResolveCompanyNames([EXTERNAL_A, EXTERNAL_A, EXTERNAL_A]);
    const queriedIds = ((inFn.mock.calls[0] as unknown[])?.[1] ?? []) as string[];
    // Should only appear once
    expect(queriedIds.filter((id) => id === EXTERNAL_A)).toHaveLength(1);
  });
});
