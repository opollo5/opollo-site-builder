import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// BSP-2 — race-safety regression test for getOrCreateBundleSocialTeam.
//
// Before BSP-2, two concurrent callers to getOrCreateBundleSocialTeam for
// the same companyId could both pass the "team is null" check before either
// had written anything, and both would call bundle.social's teamCreateTeam.
// One team became orphaned — DB-level UPDATE-WHERE-IS-NULL prevented the
// duplicate row write but NOT the duplicate billed external call.
//
// This test pins the in-process Promise dedup invariant: under concurrent
// invocation for the same company, teamCreateTeam is called EXACTLY ONCE
// and both callers receive the same team id.
//
// Layer: integration (real Supabase, mocked bundle.social SDK at the
// boundary). The race we're testing is application-level, not network-level.
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
  getOrCreateBundleSocialTeam,
} from "@/lib/platform/social/bundle-social/provision";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_RACE_ID = "abcdef00-0000-0000-0000-bbbbbbbb0117";

async function seedCompanyWithoutTeam(id: string, slug: string): Promise<void> {
  const svc = getServiceRoleClient();
  const result = await svc.from("platform_companies").insert({
    id,
    name: `Race Co ${slug}`,
    slug,
    domain: `${slug}.test`,
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (result.error) {
    throw new Error(
      `seed company ${slug}: ${result.error.code ?? "?"} ${result.error.message}`,
    );
  }
}

async function readStoredTeamId(id: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_companies")
    .select("bundle_social_team_id")
    .eq("id", id)
    .single();
  if (error) throw new Error(`read company: ${error.message}`);
  return (data?.bundle_social_team_id as string | null) ?? null;
}

beforeEach(() => {
  __resetInflightForTesting();
  teamCreateMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BSP-2 — getOrCreateBundleSocialTeam race-safety", () => {
  it("REGRESSION: concurrent calls invoke teamCreateTeam EXACTLY ONCE", async () => {
    await seedCompanyWithoutTeam(COMPANY_RACE_ID, "race1");

    // Mock teamCreateTeam to take a measurable amount of time so concurrent
    // callers actually overlap in flight (not just sequentially serialised
    // by Node's microtask queue).
    teamCreateMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { id: "team-race-winner-001" };
    });

    // Fire ten concurrent calls — overlap is guaranteed by the 50ms delay.
    const results = await Promise.all([
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
    ]);

    // Invariant 1: exactly one bundle.social API call.
    expect(teamCreateMock).toHaveBeenCalledTimes(1);

    // Invariant 2: every caller resolves to the same team id.
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("team-race-winner-001");

    // Invariant 3: DB row reflects the same team id.
    const stored = await readStoredTeamId(COMPANY_RACE_ID);
    expect(stored).toBe("team-race-winner-001");
  });

  it("after success, subsequent calls hit the fast path (no new teamCreateTeam)", async () => {
    await seedCompanyWithoutTeam(COMPANY_RACE_ID, "race2");

    teamCreateMock.mockResolvedValueOnce({ id: "team-fastpath-002" });
    const first = await getOrCreateBundleSocialTeam(COMPANY_RACE_ID);
    expect(first).toBe("team-fastpath-002");
    expect(teamCreateMock).toHaveBeenCalledTimes(1);

    // The in-flight map should have cleaned itself up (finally clause).
    // Subsequent call must read from the DB, not call the API again.
    const second = await getOrCreateBundleSocialTeam(COMPANY_RACE_ID);
    expect(second).toBe("team-fastpath-002");
    expect(teamCreateMock).toHaveBeenCalledTimes(1); // still 1 — DB fast path.
  });

  it("a failed provision releases the in-flight slot for retry", async () => {
    await seedCompanyWithoutTeam(COMPANY_RACE_ID, "race3");

    teamCreateMock.mockRejectedValueOnce(new Error("transient bundle outage"));
    await expect(
      getOrCreateBundleSocialTeam(COMPANY_RACE_ID),
    ).rejects.toThrow(/bundle\.social team creation failed/);

    // After failure, the in-flight slot must be released so a retry can
    // happen. Otherwise a single transient failure poisons the company
    // forever within this process.
    teamCreateMock.mockResolvedValueOnce({ id: "team-retry-003" });
    const retry = await getOrCreateBundleSocialTeam(COMPANY_RACE_ID);
    expect(retry).toBe("team-retry-003");
    expect(teamCreateMock).toHaveBeenCalledTimes(2);
  });
});
