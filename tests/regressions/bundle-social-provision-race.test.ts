import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION BSP-1 — getOrCreateBundleSocialTeam race-safe provisioning
//
// Incident class: two concurrent requests hit the same unprovisioned
// company simultaneously. Both read bundle_social_team_id=null, both
// call bundle.social teamCreate, and one of them should "win" the
// UPDATE WHERE IS NULL — then both must return the SAME winner team id
// (the survivor of the race-safe write), not their own team id.
//
// Pinned invariant:
//   - The UPDATE uses .is("bundle_social_team_id", null) — so the loser's
//     write silently no-ops.
//   - Both callers re-read after the UPDATE and return the winner value.
//   - The winner is always whatever the DB row ends up with.
//
// This is a unit test (no real Supabase) that drives the provisioning
// logic via mocked svc. The "loser" scenario: svc.update().is().eq()
// succeeds but the re-read returns the *winner's* team id (simulating
// that the winner's UPDATE arrived first and our UPDATE was a no-op
// because the IS NULL predicate no longer matched).
// ---------------------------------------------------------------------------

// Mock both Supabase and bundle.social before any imports.
const mockSvc = {
  from: vi.fn(),
};

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => mockSvc,
}));

const mockClient = {
  team: {
    teamCreateTeam: vi.fn(),
  },
};

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => mockClient,
  getBundlesocialTeamId: () => null,
}));

import { getOrCreateBundleSocialTeam } from "@/lib/platform/social/bundle-social/provision";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaa00000001";
const WINNER_TEAM_ID = "bst_winner_team";
const LOSER_TEAM_ID = "bst_loser_team";

function makeChain(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  const end = { data: finalResult, error: null };
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(end);
  chain.maybeSingle = vi.fn().mockResolvedValue(end);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BSP-1: getOrCreateBundleSocialTeam race-safe provisioning", () => {
  it("fast path: returns existing team_id when already provisioned", async () => {
    const chain = makeChain({ bundle_social_team_id: WINNER_TEAM_ID, name: "Acme" });
    mockSvc.from.mockReturnValue(chain);

    const result = await getOrCreateBundleSocialTeam(COMPANY_ID);
    expect(result).toBe(WINNER_TEAM_ID);
    // Should NOT have called bundle.social
    expect(mockClient.team.teamCreateTeam).not.toHaveBeenCalled();
  });

  it("slow path winner: creates team and persists when IS NULL matches", async () => {
    let callCount = 0;
    mockSvc.from.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // First read: no team yet
        return makeChain({ bundle_social_team_id: null, name: "Acme" });
      }
      // All subsequent reads/writes return winner team id
      return makeChain({ bundle_social_team_id: WINNER_TEAM_ID, name: "Acme" });
    });
    mockClient.team.teamCreateTeam.mockResolvedValueOnce({ id: WINNER_TEAM_ID, name: "Acme" });

    const result = await getOrCreateBundleSocialTeam(COMPANY_ID);
    expect(result).toBe(WINNER_TEAM_ID);
    expect(mockClient.team.teamCreateTeam).toHaveBeenCalledTimes(1);
  });

  it("slow path loser: creates team but re-read returns winner's team id", async () => {
    // Simulates the race: this caller created LOSER_TEAM_ID, but the
    // UPDATE WHERE IS NULL was a no-op (winner already wrote). The
    // re-read returns WINNER_TEAM_ID.
    let callCount = 0;
    mockSvc.from.mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // First read: not provisioned yet
        return makeChain({ bundle_social_team_id: null, name: "Acme" });
      }
      // After our UPDATE (which silently no-ops), re-read returns winner
      return makeChain({ bundle_social_team_id: WINNER_TEAM_ID, name: "Acme" });
    });
    mockClient.team.teamCreateTeam.mockResolvedValueOnce({ id: LOSER_TEAM_ID, name: "Acme" });

    const result = await getOrCreateBundleSocialTeam(COMPANY_ID);
    // Must return winner, not this caller's loser team id
    expect(result).toBe(WINNER_TEAM_ID);
    expect(result).not.toBe(LOSER_TEAM_ID);
    expect(mockClient.team.teamCreateTeam).toHaveBeenCalledTimes(1);
  });

  it("throws when company not found", async () => {
    const chain = makeChain(null);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    // Simulate company not found: single() returns null data, no error
    const notFoundChain = makeChain(null);
    notFoundChain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    mockSvc.from.mockReturnValue(notFoundChain);

    await expect(getOrCreateBundleSocialTeam(COMPANY_ID)).rejects.toThrow("not found");
  });

  it("throws when bundle.social teamCreate fails", async () => {
    let callCount = 0;
    mockSvc.from.mockImplementation(() => {
      callCount += 1;
      return makeChain({ bundle_social_team_id: null, name: "Acme" });
    });
    mockClient.team.teamCreateTeam.mockRejectedValueOnce(new Error("HTTP 503 Service Unavailable"));

    await expect(getOrCreateBundleSocialTeam(COMPANY_ID)).rejects.toThrow("HTTP 503");
  });
});
