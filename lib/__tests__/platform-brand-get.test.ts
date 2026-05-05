import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getActiveBrandProfile } from "@/lib/platform/brand";
import { getServiceRoleClient } from "@/lib/supabase";

// P-Brand-1a — getActiveBrandProfile DB read.
//
// Asserts:
//   - Returns null when company has no brand profile yet (the V1 default
//     for customer companies; only the Opollo internal seed has one).
//   - Returns the active row when one exists.
//   - Returns the active row even when older inactive versions exist
//     (the unique-active partial index guarantees at most one).
//   - Returns null on a malformed UUID without throwing (defensive
//     against route-level corruption).

const COMPANY_NO_BRAND_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const COMPANY_HAS_BRAND_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";

describe("lib/platform/brand/get — getActiveBrandProfile", () => {
  beforeAll(async () => {
    const svc = getServiceRoleClient();
    const seed = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_NO_BRAND_ID,
          name: "Brand-Test No-Brand Co",
          slug: "p-brand-1a-no-brand",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_HAS_BRAND_ID,
          name: "Brand-Test Has-Brand Co",
          slug: "p-brand-1a-has-brand",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
      ])
      .select("id");
    if (seed.error) {
      throw new Error(`seed companies: ${seed.error.message}`);
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    await svc
      .from("platform_companies")
      .delete()
      .in("id", [COMPANY_NO_BRAND_ID, COMPANY_HAS_BRAND_ID]);
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();
    // Wipe brand rows for the test companies between tests so seeds are
    // deterministic. Internal-company brand profile (from migration 0074
    // seed) is untouched.
    await svc
      .from("platform_brand_profiles")
      .delete()
      .in("company_id", [COMPANY_NO_BRAND_ID, COMPANY_HAS_BRAND_ID]);
  });

  it("returns null when the company has no brand profile yet", async () => {
    const result = await getActiveBrandProfile(COMPANY_NO_BRAND_ID);
    expect(result).toBeNull();
  });

  it("returns the active row when one exists", async () => {
    const svc = getServiceRoleClient();
    const insert = await svc
      .from("platform_brand_profiles")
      .insert({
        company_id: COMPANY_HAS_BRAND_ID,
        version: 1,
        is_active: true,
        primary_colour: "#FF03A5",
        secondary_colour: "#00E5A0",
        heading_font: "EmBauhausW00",
        industry: "Technology / SaaS",
        formality: "semi_formal",
        point_of_view: "first_person",
      })
      .select("id");
    if (insert.error) throw new Error(`seed brand: ${insert.error.message}`);

    const result = await getActiveBrandProfile(COMPANY_HAS_BRAND_ID);
    expect(result).not.toBeNull();
    expect(result?.company_id).toBe(COMPANY_HAS_BRAND_ID);
    expect(result?.is_active).toBe(true);
    expect(result?.version).toBe(1);
    expect(result?.primary_colour).toBe("#FF03A5");
    expect(result?.industry).toBe("Technology / SaaS");
    expect(result?.formality).toBe("semi_formal");
    // Defaults from the column DEFAULTs:
    expect(result?.safe_mode).toBe(false);
    expect(result?.personality_traits).toEqual([]);
    expect(result?.image_style).toEqual({});
  });

  it("returns the active row when an older inactive version also exists", async () => {
    const svc = getServiceRoleClient();
    const seed = await svc
      .from("platform_brand_profiles")
      .insert([
        {
          company_id: COMPANY_HAS_BRAND_ID,
          version: 1,
          is_active: false,
          change_summary: "v1 initial",
          primary_colour: "#000000",
        },
        {
          company_id: COMPANY_HAS_BRAND_ID,
          version: 2,
          is_active: true,
          change_summary: "v2 brand refresh",
          primary_colour: "#FF03A5",
        },
      ])
      .select("id");
    if (seed.error) throw new Error(`seed: ${seed.error.message}`);

    const result = await getActiveBrandProfile(COMPANY_HAS_BRAND_ID);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);
    expect(result?.primary_colour).toBe("#FF03A5");
    expect(result?.change_summary).toBe("v2 brand refresh");
  });

  it("returns null (not throws) on malformed UUID input", async () => {
    const result = await getActiveBrandProfile("not-a-uuid");
    expect(result).toBeNull();
  });
});
