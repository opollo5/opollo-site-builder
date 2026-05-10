import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// BSP-6 — race-safety regression test for getOrCreateBundleSocialTeamForProfile.
//
// Mirrors the BSP-2 provision-race test (lib/__tests__/bundle-social-provision-race.test.ts)
// but operates on platform_social_profiles instead of platform_companies.
// Pins the same invariant: under concurrent invocation for the same
// profileId, teamCreateTeam is called EXACTLY ONCE.
//
// Layer: integration (real Supabase, mocked bundle.social SDK at the
// boundary).
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
  __resetInflightForTesting,
  getOrCreateBundleSocialTeamForProfile,
} from "@/lib/platform/social/profiles/provision-team";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa0120";

async function seedCompanyAndDefault(): Promise<string> {
  // Migration 0119 trigger creates the default profile automatically.
  const svc = getServiceRoleClient();
  const insert = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "BSP6 Race Co",
    slug: "bsp6-race",
    domain: "bsp6-race.test",
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (insert.error) {
    throw new Error(`seed company: ${insert.error.message}`);
  }
  // Read back the trigger-created default profile id.
  const { data, error } = await svc
    .from("platform_social_profiles")
    .select("id")
    .eq("company_id", COMPANY_ID)
    .eq("is_default", true)
    .single();
  if (error || !data) {
    throw new Error(`read default profile: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

async function readStoredTeamId(profileId: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .select("bundle_social_team_id")
    .eq("id", profileId)
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

describe("BSP-6 — getOrCreateBundleSocialTeamForProfile race-safety", () => {
  it("REGRESSION: concurrent calls invoke teamCreateTeam EXACTLY ONCE", async () => {
    const profileId = await seedCompanyAndDefault();

    teamCreateMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: "team-profile-race-001" };
    });

    const results = await Promise.all([
      getOrCreateBundleSocialTeamForProfile(profileId),
      getOrCreateBundleSocialTeamForProfile(profileId),
      getOrCreateBundleSocialTeamForProfile(profileId),
      getOrCreateBundleSocialTeamForProfile(profileId),
      getOrCreateBundleSocialTeamForProfile(profileId),
    ]);

    expect(teamCreateMock).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("team-profile-race-001");

    const stored = await readStoredTeamId(profileId);
    expect(stored).toBe("team-profile-race-001");
  });

  it("after success, subsequent calls hit the fast path (no new teamCreateTeam)", async () => {
    const profileId = await seedCompanyAndDefault();

    teamCreateMock.mockResolvedValueOnce({ id: "team-profile-fastpath-002" });
    const first = await getOrCreateBundleSocialTeamForProfile(profileId);
    expect(first).toBe("team-profile-fastpath-002");
    expect(teamCreateMock).toHaveBeenCalledTimes(1);

    const second = await getOrCreateBundleSocialTeamForProfile(profileId);
    expect(second).toBe("team-profile-fastpath-002");
    expect(teamCreateMock).toHaveBeenCalledTimes(1);
  });

  it("a failed provision releases the in-flight slot for retry", async () => {
    const profileId = await seedCompanyAndDefault();

    teamCreateMock.mockRejectedValueOnce(new Error("transient bundle outage"));
    await expect(
      getOrCreateBundleSocialTeamForProfile(profileId),
    ).rejects.toThrow(/bundle\.social team creation failed/);

    teamCreateMock.mockResolvedValueOnce({ id: "team-profile-retry-003" });
    const retry = await getOrCreateBundleSocialTeamForProfile(profileId);
    expect(retry).toBe("team-profile-retry-003");
    expect(teamCreateMock).toHaveBeenCalledTimes(2);
  });

  it("uses profile.name (not company.name) for the bundle.social team name", async () => {
    const profileId = await seedCompanyAndDefault();
    // Rename the default profile so we can verify the profile name was used.
    const svc = getServiceRoleClient();
    await svc
      .from("platform_social_profiles")
      .update({ name: "Custom Profile Name" })
      .eq("id", profileId);

    teamCreateMock.mockResolvedValueOnce({ id: "team-profile-named-004" });
    await getOrCreateBundleSocialTeamForProfile(profileId);

    const lastCall = teamCreateMock.mock.calls[0]?.[0];
    expect(lastCall?.requestBody?.name).toContain("Custom Profile Name");
  });
});
