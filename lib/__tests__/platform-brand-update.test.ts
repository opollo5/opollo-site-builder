import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getActiveBrandProfile, updateBrandProfile } from "@/lib/platform/brand";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// P-Brand-1b — updateBrandProfile contract.
//
// Asserts:
//   - First call against a company with no profile bootstraps v1 with
//     `created: true`.
//   - Subsequent call against the same company runs the versioning RPC
//     (v2 with is_active=true; v1 flipped to is_active=false).
//   - The `is_active` partial index guarantees exactly one active row
//     per company at any time.
//   - Unchanged fields persist through to v+1 via the RPC's
//     COALESCE-against-current logic (operator only submits the diff).
//   - VALIDATION_FAILED on bad UUID input.

const COMPANY_ID = "ddddeeee-bbbb-bbbb-bbbb-bbbbbbbb1b1b";

describe("lib/platform/brand/update — updateBrandProfile", () => {
  let actor: SeededAuthUser;

  beforeAll(async () => {
    actor = await seedAuthUser({
      email: "p-brand-1b-actor@opollo.test",
      persistent: true,
    });

    const svc = getServiceRoleClient();
    const seedCompany = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "Brand-Update Test Co",
        slug: "p-brand-1b-test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
      })
      .select("id");
    if (seedCompany.error) {
      throw new Error(`seed company: ${seedCompany.error.message}`);
    }

    // updateBrandProfile inserts created_by/updated_by referencing
    // platform_users; we must seed the actor's profile row.
    const seedUser = await svc
      .from("platform_users")
      .insert({
        id: actor.id,
        email: actor.email,
        full_name: "Brand Test Actor",
        is_opollo_staff: false,
      })
      .select("id");
    if (seedUser.error) {
      throw new Error(`seed user: ${seedUser.error.message}`);
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    await svc
      .from("platform_brand_profiles")
      .delete()
      .eq("company_id", COMPANY_ID);
    await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
    if (actor) await svc.auth.admin.deleteUser(actor.id);
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();
    await svc
      .from("platform_brand_profiles")
      .delete()
      .eq("company_id", COMPANY_ID);
  });

  it("bootstraps v1 with created=true when no profile exists", async () => {
    const result = await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "Initial",
      fields: {
        primary_colour: "#FF03A5",
        heading_font: "EmBauhausW00",
        formality: "semi_formal",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(true);
    expect(result.brand.version).toBe(1);
    expect(result.brand.is_active).toBe(true);
    expect(result.brand.primary_colour).toBe("#FF03A5");
    expect(result.brand.heading_font).toBe("EmBauhausW00");
    expect(result.brand.formality).toBe("semi_formal");
    expect(result.brand.change_summary).toBe("Initial");
  });

  it("routes through the versioning RPC on subsequent edits", async () => {
    // v1
    const first = await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v1 setup",
      fields: {
        primary_colour: "#000000",
        industry: "Technology",
        formality: "formal",
        personality_traits: ["professional"],
      },
    });
    expect(first.ok).toBe(true);

    // v2 — only changing the primary colour
    const second = await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v2 brand refresh",
      fields: { primary_colour: "#FF03A5" },
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.created).toBe(false);
    expect(second.brand.version).toBe(2);
    expect(second.brand.is_active).toBe(true);
    expect(second.brand.primary_colour).toBe("#FF03A5");
    // RPC's COALESCE carries forward unchanged fields:
    expect(second.brand.industry).toBe("Technology");
    expect(second.brand.formality).toBe("formal");
    expect(second.brand.personality_traits).toEqual(["professional"]);
    expect(second.brand.change_summary).toBe("v2 brand refresh");
  });

  it("leaves exactly one active row per company across edits", async () => {
    const svc = getServiceRoleClient();

    await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v1",
      fields: { primary_colour: "#111111" },
    });
    await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v2",
      fields: { primary_colour: "#222222" },
    });
    await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v3",
      fields: { primary_colour: "#333333" },
    });

    const allRows = await svc
      .from("platform_brand_profiles")
      .select("version, is_active, primary_colour")
      .eq("company_id", COMPANY_ID)
      .order("version", { ascending: true });
    if (allRows.error) throw new Error(allRows.error.message);

    expect(allRows.data).toHaveLength(3);
    const active = allRows.data!.filter((r) => r.is_active);
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(3);
    expect(active[0].primary_colour).toBe("#333333");

    const inactive = allRows.data!.filter((r) => !r.is_active);
    expect(inactive.map((r) => r.version)).toEqual([1, 2]);
  });

  it("getActiveBrandProfile picks up the new active row after each edit", async () => {
    await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v1",
      fields: { primary_colour: "#000000" },
    });
    let read = await getActiveBrandProfile(COMPANY_ID);
    expect(read?.version).toBe(1);
    expect(read?.primary_colour).toBe("#000000");

    await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: actor.id,
      changeSummary: "v2",
      fields: { primary_colour: "#FF03A5" },
    });
    read = await getActiveBrandProfile(COMPANY_ID);
    expect(read?.version).toBe(2);
    expect(read?.primary_colour).toBe("#FF03A5");
  });

  it("returns VALIDATION_FAILED on malformed UUID input", async () => {
    const badCompany = await updateBrandProfile({
      companyId: "not-a-uuid",
      updatedBy: actor.id,
      changeSummary: null,
      fields: { primary_colour: "#000000" },
    });
    expect(badCompany.ok).toBe(false);
    if (badCompany.ok) return;
    expect(badCompany.error.code).toBe("VALIDATION_FAILED");

    const badActor = await updateBrandProfile({
      companyId: COMPANY_ID,
      updatedBy: "also-not-a-uuid",
      changeSummary: null,
      fields: { primary_colour: "#000000" },
    });
    expect(badActor.ok).toBe(false);
    if (badActor.ok) return;
    expect(badActor.error.code).toBe("VALIDATION_FAILED");
  });
});
