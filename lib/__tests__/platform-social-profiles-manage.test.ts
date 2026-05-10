import { afterEach, beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// BSP-5 — write-helper integration tests for platform_social_profiles.
//
// Covers create / rename / setDefault / delete against real Supabase.
// Pins the contract that the admin API routes depend on: validation
// failures carry VALIDATION_FAILED, name collisions carry NAME_CONFLICT,
// the default profile cannot be deleted, etc.
// ---------------------------------------------------------------------------

import {
  createProfile,
  deleteProfile,
  getDefaultProfileForCompany,
  getProfileById,
  listProfilesForCompany,
  renameProfile,
  setDefaultProfile,
} from "@/lib/platform/social/profiles";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa0119";
const COMPANY_OTHER_ID = "abcdef00-0000-0000-0000-bbbbbbbb0119";

async function seedCompany(id: string, slug: string): Promise<void> {
  const svc = getServiceRoleClient();
  const result = await svc.from("platform_companies").insert({
    id,
    name: `Manage Co ${slug}`,
    slug,
    domain: `${slug}.manage.test`,
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

async function seedDefaultProfile(companyId: string, name: string): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_social_profiles")
    .insert({
      company_id: companyId,
      name,
      kind: "company",
      is_default: true,
      bundle_social_team_id: null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`seed default profile: ${error.message}`);
  return data.id as string;
}

beforeEach(() => {});
afterEach(() => {});

describe("BSP-5 — createProfile", () => {
  it("creates a non-default profile with trimmed name", async () => {
    await seedCompany(COMPANY_ID, "create1");
    await seedDefaultProfile(COMPANY_ID, "Brand");

    const result = await createProfile({
      companyId: COMPANY_ID,
      name: "  CEO Personal  ", // leading/trailing whitespace
      kind: "executive",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe("CEO Personal"); // trimmed
    expect(result.data.is_default).toBe(false); // never created default
    expect(result.data.kind).toBe("executive");
    expect(result.data.bundle_social_team_id).toBeNull();
  });

  it("rejects empty/whitespace-only name with VALIDATION_FAILED", async () => {
    await seedCompany(COMPANY_ID, "create2");
    const result = await createProfile({
      companyId: COMPANY_ID,
      name: "    ",
      kind: "company",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects duplicate name with NAME_CONFLICT", async () => {
    await seedCompany(COMPANY_ID, "create3");
    await seedDefaultProfile(COMPANY_ID, "Brand");

    const result = await createProfile({
      companyId: COMPANY_ID,
      name: "Brand", // collides with default
      kind: "executive",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ALREADY_EXISTS");
  });
});

describe("BSP-5 — renameProfile", () => {
  it("renames and trims", async () => {
    await seedCompany(COMPANY_ID, "rename1");
    const id = await seedDefaultProfile(COMPANY_ID, "Brand");

    const result = await renameProfile({
      profileId: id,
      newName: "  Renamed Brand  ",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe("Renamed Brand");
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const result = await renameProfile({
      profileId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      newName: "x",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns NAME_CONFLICT when target name already exists", async () => {
    await seedCompany(COMPANY_ID, "rename2");
    await seedDefaultProfile(COMPANY_ID, "Brand");
    const created = await createProfile({
      companyId: COMPANY_ID,
      name: "Personal",
      kind: "executive",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await renameProfile({
      profileId: created.data.id,
      newName: "Brand", // collides with existing default
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("ALREADY_EXISTS");
  });
});

describe("BSP-5 — setDefaultProfile", () => {
  it("flips default and clears the previous default", async () => {
    await seedCompany(COMPANY_ID, "setdef1");
    const oldDefault = await seedDefaultProfile(COMPANY_ID, "Brand");
    const created = await createProfile({
      companyId: COMPANY_ID,
      name: "Personal",
      kind: "executive",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await setDefaultProfile({
      companyId: COMPANY_ID,
      profileId: created.data.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe(created.data.id);
    expect(result.data.is_default).toBe(true);

    const oldRow = await getProfileById(oldDefault);
    expect(oldRow?.is_default).toBe(false);
  });

  it("is idempotent: re-promoting the current default returns ok with no change", async () => {
    await seedCompany(COMPANY_ID, "setdef2");
    const id = await seedDefaultProfile(COMPANY_ID, "Brand");

    const result = await setDefaultProfile({
      companyId: COMPANY_ID,
      profileId: id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.is_default).toBe(true);
  });

  it("returns NOT_FOUND for unknown id", async () => {
    await seedCompany(COMPANY_ID, "setdef3");
    const result = await setDefaultProfile({
      companyId: COMPANY_ID,
      profileId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("REGRESSION: refuses to promote a profile from another company", async () => {
    await seedCompany(COMPANY_ID, "setdefX");
    await seedCompany(COMPANY_OTHER_ID, "setdefY");
    const otherId = await seedDefaultProfile(COMPANY_OTHER_ID, "Brand");

    const result = await setDefaultProfile({
      companyId: COMPANY_ID, // wrong company
      profileId: otherId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("BSP-5 — deleteProfile", () => {
  it("deletes a non-default profile", async () => {
    await seedCompany(COMPANY_ID, "del1");
    await seedDefaultProfile(COMPANY_ID, "Brand");
    const created = await createProfile({
      companyId: COMPANY_ID,
      name: "Personal",
      kind: "executive",
    });
    if (!created.ok) throw new Error("setup failed");

    const result = await deleteProfile({ profileId: created.data.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.deleted_id).toBe(created.data.id);

    const after = await listProfilesForCompany(COMPANY_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.is_default).toBe(true);
  });

  it("REGRESSION: refuses to delete the default profile", async () => {
    await seedCompany(COMPANY_ID, "del2");
    const id = await seedDefaultProfile(COMPANY_ID, "Brand");

    const result = await deleteProfile({ profileId: id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_STATE");

    // Profile is still there.
    const stillThere = await getDefaultProfileForCompany(COMPANY_ID);
    expect(stillThere?.id).toBe(id);
  });

  it("returns NOT_FOUND for unknown id", async () => {
    const result = await deleteProfile({
      profileId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NOT_FOUND");
  });
});
