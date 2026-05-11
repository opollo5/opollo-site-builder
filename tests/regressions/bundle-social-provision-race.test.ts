import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION BSP-2 — getOrCreateBundleSocialTeam advisory-lock provisioning
//
// Updated for BSP-2-REDO: provision.ts now uses a direct pg transaction with
// pg_advisory_xact_lock instead of Supabase JS + optimistic UPDATE WHERE IS NULL.
// Cross-process race safety is now guaranteed by the advisory lock rather than
// the write-predicate pattern.
//
// This unit test verifies per-call behaviour (fast path, slow path, error
// handling) by mocking pg.Client so no real Supabase connection is needed.
// The advisory lock's cross-process serialisation guarantee is covered by the
// integration test in lib/__tests__/bundle-social-provision-race.test.ts.
// ---------------------------------------------------------------------------

const { teamCreateMock, mockQuery, mockConnect, mockEnd } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockEnd = vi.fn().mockResolvedValue(undefined);
  const teamCreateMock = vi.fn();
  return { teamCreateMock, mockQuery, mockConnect, mockEnd };
});

vi.mock("pg", () => {
  class Client {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
  }
  return { Client };
});

vi.mock("@/lib/db-direct", () => ({
  requireDbConfig: () => ({}),
}));

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({ team: { teamCreateTeam: teamCreateMock } }),
  getBundlesocialTeamId: () => null,
}));

import { getOrCreateBundleSocialTeam } from "@/lib/platform/social/bundle-social/provision";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaa00000001";
const TEAM_ID = "bst_winner_team";

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
});

describe("BSP-2: getOrCreateBundleSocialTeam advisory-lock provisioning", () => {
  it("fast path: returns existing team_id without calling teamCreateTeam", async () => {
    // Query sequence: BEGIN → lock → SELECT (already has team id) → COMMIT
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({
        rows: [{ bundle_social_team_id: TEAM_ID, name: "Acme" }],
      }) // SELECT
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await getOrCreateBundleSocialTeam(COMPANY_ID);

    expect(result).toBe(TEAM_ID);
    expect(teamCreateMock).not.toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it("slow path: provisions new team and persists it when not yet set", async () => {
    // Query sequence: BEGIN → lock → SELECT (null) → UPDATE → COMMIT
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({
        rows: [{ bundle_social_team_id: null, name: "Acme" }],
      }) // SELECT
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce(undefined); // COMMIT
    teamCreateMock.mockResolvedValueOnce({ id: TEAM_ID });

    const result = await getOrCreateBundleSocialTeam(COMPANY_ID);

    expect(result).toBe(TEAM_ID);
    expect(teamCreateMock).toHaveBeenCalledTimes(1);
    expect(mockEnd).toHaveBeenCalled();
  });

  it("throws when company not found", async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [] }) // SELECT → empty
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await expect(getOrCreateBundleSocialTeam(COMPANY_ID)).rejects.toThrow(
      "not found",
    );
    expect(mockEnd).toHaveBeenCalled();
  });

  it("throws and rolls back when bundle.social teamCreate fails", async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({
        rows: [{ bundle_social_team_id: null, name: "Acme" }],
      }) // SELECT
      .mockResolvedValueOnce(undefined); // ROLLBACK
    teamCreateMock.mockRejectedValueOnce(
      new Error("HTTP 503 Service Unavailable"),
    );

    await expect(getOrCreateBundleSocialTeam(COMPANY_ID)).rejects.toThrow(
      "HTTP 503",
    );
    expect(mockEnd).toHaveBeenCalled();
  });

  it("closes the pg connection even when ROLLBACK itself errors", async () => {
    mockQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pg_advisory_xact_lock
      .mockResolvedValueOnce({
        rows: [{ bundle_social_team_id: null, name: "Acme" }],
      }) // SELECT
      .mockRejectedValueOnce(new Error("ROLLBACK failed")); // ROLLBACK errors
    teamCreateMock.mockRejectedValueOnce(new Error("API down"));

    await expect(getOrCreateBundleSocialTeam(COMPANY_ID)).rejects.toThrow(
      "API down",
    );
    // pg.end() must still be called despite ROLLBACK failing.
    expect(mockEnd).toHaveBeenCalled();
  });
});
