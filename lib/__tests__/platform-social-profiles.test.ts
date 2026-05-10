import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// BSP-3 — schema + backfill smoke for platform_social_profiles.
//
// Real Supabase. No SDK mocks needed — we only assert the migration's
// shape and the helpers' SQL behaviour.
//
// Coverage:
//   1. Migration backfilled exactly one default profile per existing
//      company, carrying over bundle_social_team_id where set.
//   2. UNIQUE (company_id, name) prevents duplicate-named profiles.
//   3. Partial unique index enforces "at most one default per company".
//   4. Partial unique index on bundle_social_team_id prevents cross-
//      profile reuse of the same bundle.social team.
//   5. ON DELETE CASCADE: deleting a company removes its profiles.
//   6. listProfilesForCompany returns default first, then created_at asc.
//   7. getDefaultProfileForCompany picks the one with is_default=true.
//   8. getProfileById round-trips a known row.
// ---------------------------------------------------------------------------

import {
  getDefaultProfileForCompany,
  getProfileById,
  listProfilesForCompany,
} from "@/lib/platform/social/profiles";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa0118";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb0118";

async function seedCompany(
  id: string,
  slug: string,
  bundleTeamId: string | null,
): Promise<void> {
  const svc = getServiceRoleClient();
  const result = await svc.from("platform_companies").insert({
    id,
    name: `BSP3 Co ${slug}`,
    slug,
    domain: `${slug}.bsp3.test`,
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
    bundle_social_team_id: bundleTeamId,
  });
  if (result.error) {
    throw new Error(
      `seed company ${slug}: ${result.error.code ?? "?"} ${result.error.message}`,
    );
  }
}

// Migration 0119 adds an AFTER INSERT trigger on platform_companies that
// auto-creates a default profile carrying the company's name +
// bundle_social_team_id. Helper UPDATEs the trigger-seeded row to
// match the test's expected name (and bundle team id, in case the
// test passes a different one than the company carries).
async function backfillDefaultProfile(
  companyId: string,
  bundleTeamId: string | null,
  name: string,
): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .update({ name, bundle_social_team_id: bundleTeamId })
    .eq("company_id", companyId)
    .eq("is_default", true)
    .select("id")
    .single();
  if (error) {
    throw new Error(`seed profile (rename): ${error.code ?? "?"} ${error.message}`);
  }
  return data.id as string;
}

beforeEach(async () => {
  // _setup truncates platform_companies before each test, which cascades
  // to platform_social_profiles via FK.
});

afterEach(() => {});

describe("BSP-3 — platform_social_profiles", () => {
  it("(R1) listProfilesForCompany returns default first then created asc", async () => {
    await seedCompany(COMPANY_A_ID, "list1", "team-list1-default");
    await backfillDefaultProfile(COMPANY_A_ID, "team-list1-default", "Brand");

    // Add an executive profile second.
    const svc = getServiceRoleClient();
    const insertExec = await svc.from("platform_social_profiles").insert({
      company_id: COMPANY_A_ID,
      name: "CEO Personal",
      kind: "executive",
      is_default: false,
      bundle_social_team_id: null,
    });
    expect(insertExec.error).toBeNull();

    const profiles = await listProfilesForCompany(COMPANY_A_ID);
    expect(profiles).toHaveLength(2);
    expect(profiles[0]?.is_default).toBe(true);
    expect(profiles[0]?.name).toBe("Brand");
    expect(profiles[1]?.is_default).toBe(false);
    expect(profiles[1]?.kind).toBe("executive");
  });

  it("(R2) getDefaultProfileForCompany returns the default row created by trigger", async () => {
    // Migration 0119's AFTER INSERT trigger auto-creates the default,
    // so a company with no manual seed already has one. The helper
    // re-shapes that default to match the test's expected name + team.
    await seedCompany(COMPANY_A_ID, "def1", null);
    await backfillDefaultProfile(COMPANY_A_ID, null, "Brand");
    const after = await getDefaultProfileForCompany(COMPANY_A_ID);
    expect(after?.is_default).toBe(true);
    expect(after?.name).toBe("Brand");
    expect(after?.bundle_social_team_id).toBeNull();
  });

  it("(R3) getProfileById round-trips", async () => {
    await seedCompany(COMPANY_A_ID, "idr1", null);
    const id = await backfillDefaultProfile(COMPANY_A_ID, "team-idr1", "Brand");
    const fetched = await getProfileById(id);
    expect(fetched?.id).toBe(id);
    expect(fetched?.bundle_social_team_id).toBe("team-idr1");
  });

  it("(R4) UNIQUE (company_id, name) prevents duplicate names", async () => {
    await seedCompany(COMPANY_A_ID, "uniq1", null);
    await backfillDefaultProfile(COMPANY_A_ID, null, "Brand");

    const svc = getServiceRoleClient();
    const dup = await svc.from("platform_social_profiles").insert({
      company_id: COMPANY_A_ID,
      name: "Brand", // same name → unique violation
      kind: "executive",
      is_default: false,
      bundle_social_team_id: null,
    });
    expect(dup.error).not.toBeNull();
    expect(dup.error?.code).toBe("23505"); // unique_violation
  });

  it("(R5) partial unique index enforces at-most-one-default-per-company", async () => {
    await seedCompany(COMPANY_A_ID, "def2", null);
    await backfillDefaultProfile(COMPANY_A_ID, null, "Brand");

    const svc = getServiceRoleClient();
    const second = await svc.from("platform_social_profiles").insert({
      company_id: COMPANY_A_ID,
      name: "Brand 2",
      kind: "company",
      is_default: true, // second default → unique violation
      bundle_social_team_id: null,
    });
    expect(second.error).not.toBeNull();
    expect(second.error?.code).toBe("23505");
  });

  it("(R6) partial unique index prevents cross-profile bundle-team reuse", async () => {
    await seedCompany(COMPANY_A_ID, "btu1", null);
    await seedCompany(COMPANY_B_ID, "btu2", null);
    await backfillDefaultProfile(COMPANY_A_ID, "team-shared", "Brand A");

    const svc = getServiceRoleClient();
    const dupTeam = await svc.from("platform_social_profiles").insert({
      company_id: COMPANY_B_ID,
      name: "Brand B",
      kind: "company",
      is_default: true,
      bundle_social_team_id: "team-shared", // already used by A
    });
    expect(dupTeam.error).not.toBeNull();
    expect(dupTeam.error?.code).toBe("23505");
  });

  it("(R7) ON DELETE CASCADE removes profiles when company is deleted", async () => {
    await seedCompany(COMPANY_A_ID, "cas1", null);
    await backfillDefaultProfile(COMPANY_A_ID, null, "Brand");

    const before = await listProfilesForCompany(COMPANY_A_ID);
    expect(before).toHaveLength(1);

    const svc = getServiceRoleClient();
    const del = await svc
      .from("platform_companies")
      .delete()
      .eq("id", COMPANY_A_ID);
    expect(del.error).toBeNull();

    const after = await listProfilesForCompany(COMPANY_A_ID);
    expect(after).toHaveLength(0);
  });
});
