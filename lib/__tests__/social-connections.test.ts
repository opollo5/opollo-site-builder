import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { listConnections } from "@/lib/platform/social/connections";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-12 — connections list (read-only).
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa2222";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb2222";

describe("lib/platform/social/connections/list", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-12-creator@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "s1-12-acme",
          domain: "s1-12-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-12-beta",
          domain: "s1-12-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const user = await svc
      .from("platform_users")
      .insert({
        id: creator.id,
        email: creator.email,
        full_name: "Creator",
        is_opollo_staff: false,
      })
      .select("id");
    if (user.error) {
      throw new Error(
        `seed creator: ${user.error.code ?? "?"} ${user.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  it("returns an empty array for a company with no connections", async () => {
    const result = await listConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.connections).toEqual([]);
  });

  it("returns connections scoped to the queried company only, ordered by connected_at desc", async () => {
    const svc = getServiceRoleClient();

    const inserted = await svc
      .from("social_connections")
      .insert([
        {
          company_id: COMPANY_A_ID,
          platform: "linkedin_personal",
          bundle_social_account_id: "ba_a_li",
          display_name: "Acme LI",
          status: "healthy",
          connected_at: "2026-04-01T00:00:00Z",
        },
        {
          company_id: COMPANY_A_ID,
          platform: "x",
          bundle_social_account_id: "ba_a_x",
          display_name: "Acme X",
          status: "auth_required",
          last_error: "OAuth token expired",
          connected_at: "2026-05-01T00:00:00Z",
        },
        {
          company_id: COMPANY_B_ID,
          platform: "facebook_page",
          bundle_social_account_id: "ba_b_fb",
          display_name: "Beta FB",
          status: "healthy",
          connected_at: "2026-04-15T00:00:00Z",
        },
      ])
      .select("id");
    expect(inserted.error).toBeNull();

    const result = await listConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.connections.length).toBe(2);

    // Newer connected_at first.
    expect(result.data.connections[0]?.platform).toBe("x");
    expect(result.data.connections[0]?.status).toBe("auth_required");
    expect(result.data.connections[0]?.last_error).toBe(
      "OAuth token expired",
    );
    expect(result.data.connections[1]?.platform).toBe("linkedin_personal");

    // Cross-company isolation.
    const bResult = await listConnections({ companyId: COMPANY_B_ID });
    expect(bResult.ok).toBe(true);
    if (!bResult.ok) return;
    expect(bResult.data.connections.length).toBe(1);
    expect(bResult.data.connections[0]?.platform).toBe("facebook_page");
  });

  it("rejects empty company id with VALIDATION_FAILED", async () => {
    const result = await listConnections({ companyId: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_FAILED");
  });

  it("preserves all status values in the result envelope", async () => {
    const svc = getServiceRoleClient();
    await svc.from("social_connections").insert([
      {
        company_id: COMPANY_A_ID,
        platform: "linkedin_personal",
        bundle_social_account_id: "h",
        status: "healthy",
      },
      {
        company_id: COMPANY_A_ID,
        platform: "linkedin_company",
        bundle_social_account_id: "d",
        status: "degraded",
      },
      {
        company_id: COMPANY_A_ID,
        platform: "facebook_page",
        bundle_social_account_id: "a",
        status: "auth_required",
      },
      {
        company_id: COMPANY_A_ID,
        platform: "gbp",
        bundle_social_account_id: "x",
        status: "disconnected",
      },
    ]);

    const result = await listConnections({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const statuses = result.data.connections.map((c) => c.status).sort();
    expect(statuses).toEqual(
      ["auth_required", "degraded", "disconnected", "healthy"].sort(),
    );
  });
});
