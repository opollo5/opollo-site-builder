import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// BSP-2-REDO — advisory-lock race-safety regression test for
// getOrCreateBundleSocialTeamForProfile.
//
// Two goals:
//   1. Verify the pg_advisory_xact_lock path end-to-end: 5 concurrent pg
//      transactions racing (bypassing the in-process Map) must result in
//      EXACTLY ONE teamCreateTeam call. This is the cross-process guarantee.
//   2. Verify the in-process Map fast path: 10 concurrent calls through the
//      public API still produce exactly one teamCreateTeam call (same as
//      BSP-2 company-level test shape).
//
// Layer: integration (real Supabase + real advisory lock, mocked bundle.social
// SDK at the API boundary).
// ---------------------------------------------------------------------------

const teamCreateMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    team: {
      teamCreateTeam: teamCreateMock,
    },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

import {
  __provisionWithoutInflightForTesting,
  __resetInflightForTesting,
  getOrCreateBundleSocialTeamForProfile,
} from "@/lib/platform/social/profiles/provision-team";
import { getServiceRoleClient } from "@/lib/supabase";

// Stable UUIDs scoped to this test file — beforeEach TRUNCATE resets state.
const COMPANY_ID = "c0a801aa-8200-4000-a000-000000000201";
const PROFILE_ID = "c0a801aa-8200-4000-a000-000000000200";

async function seedPrereqs(): Promise<void> {
  const svc = getServiceRoleClient();

  const co = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "Advisory Lock Test Co",
    slug: "advisory-lock-co",
    domain: "advisory-lock-co.test",
    is_opollo_internal: false,
    timezone: "UTC",
    approval_default_rule: "any_one",
  });
  if (co.error) throw new Error(`seed company: ${co.error.message}`);

  const pr = await svc.from("platform_social_profiles").insert({
    id: PROFILE_ID,
    company_id: COMPANY_ID,
    name: "Advisory Lock Profile",
    kind: "company",
  });
  if (pr.error) throw new Error(`seed profile: ${pr.error.message}`);
}

async function readStoredTeamId(): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .eq("id", PROFILE_ID)
    .single();
  if (error) throw new Error(`read profile: ${error.message}`);
  return (data?.bundle_social_team_id as string | null) ?? null;
}

beforeEach(() => {
  __resetInflightForTesting();
  teamCreateMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BSP-2-REDO — getOrCreateBundleSocialTeamForProfile advisory-lock race-safety", () => {
  it("REGRESSION: 5 concurrent pg transactions invoke teamCreateTeam EXACTLY ONCE", async () => {
    await seedPrereqs();

    // 50ms delay ensures concurrent callers overlap in flight (not
    // sequentially serialised by the microtask queue alone).
    teamCreateMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: "team-profile-advisory-001" };
    });

    // __provisionWithoutInflightForTesting bypasses the in-process Map so
    // each call opens its own pg transaction and races for the advisory lock.
    const results = await Promise.all([
      __provisionWithoutInflightForTesting(PROFILE_ID),
      __provisionWithoutInflightForTesting(PROFILE_ID),
      __provisionWithoutInflightForTesting(PROFILE_ID),
      __provisionWithoutInflightForTesting(PROFILE_ID),
      __provisionWithoutInflightForTesting(PROFILE_ID),
    ]);

    expect(teamCreateMock).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("team-profile-advisory-001");

    const stored = await readStoredTeamId();
    expect(stored).toBe("team-profile-advisory-001");
  });

  it("in-process Map fast path: 10 concurrent calls invoke teamCreateTeam EXACTLY ONCE", async () => {
    await seedPrereqs();

    teamCreateMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: "team-profile-map-002" };
    });

    const results = await Promise.all([
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
    ]);

    expect(teamCreateMock).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("team-profile-map-002");

    const stored = await readStoredTeamId();
    expect(stored).toBe("team-profile-map-002");
  });

  it("after success, subsequent calls hit the fast path (no new teamCreateTeam)", async () => {
    await seedPrereqs();

    teamCreateMock.mockResolvedValueOnce({ id: "team-profile-fastpath-003" });
    const first = await getOrCreateBundleSocialTeamForProfile(PROFILE_ID);
    expect(first).toBe("team-profile-fastpath-003");
    expect(teamCreateMock).toHaveBeenCalledTimes(1);

    const second = await getOrCreateBundleSocialTeamForProfile(PROFILE_ID);
    expect(second).toBe("team-profile-fastpath-003");
    expect(teamCreateMock).toHaveBeenCalledTimes(1);
  });

  it("a failed provision releases the in-flight slot for retry", async () => {
    await seedPrereqs();

    teamCreateMock.mockRejectedValueOnce(new Error("transient bundle outage"));
    await expect(
      getOrCreateBundleSocialTeamForProfile(PROFILE_ID),
    ).rejects.toThrow(/bundle\.social team creation failed/);

    teamCreateMock.mockResolvedValueOnce({ id: "team-profile-retry-004" });
    const retry = await getOrCreateBundleSocialTeamForProfile(PROFILE_ID);
    expect(retry).toBe("team-profile-retry-004");
    expect(teamCreateMock).toHaveBeenCalledTimes(2);
  });
});
