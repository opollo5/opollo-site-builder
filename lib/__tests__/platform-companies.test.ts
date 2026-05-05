import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { listPlatformCompanies } from "@/lib/platform/companies";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// P3-1: lib/platform/companies/list.ts
//
// Asserts the list helper returns ordered companies with member counts
// computed correctly. Service-role bypasses RLS so this exercises the
// pure data-layer behaviour; the server-component / page integration is
// covered by the e2e spec (e2e/platform-companies.spec.ts).
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "88888888-8888-8888-8888-888888888888";
const COMPANY_B_ID = "99999999-9999-9999-9999-999999999999";

describe("lib/platform/companies/list — listPlatformCompanies", () => {
  let userA1: SeededAuthUser;
  let userA2: SeededAuthUser;
  let userB1: SeededAuthUser;

  beforeAll(async () => {
    userA1 = await seedAuthUser({
      email: "p3-a1@opollo.test",
      persistent: true,
    });
    userA2 = await seedAuthUser({
      email: "p3-a2@opollo.test",
      persistent: true,
    });
    userB1 = await seedAuthUser({
      email: "p3-b1@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    // Two companies, A created later so it appears first in desc order.
    const baselineCreatedAt = new Date(Date.now() - 60_000).toISOString();
    const recentCreatedAt = new Date().toISOString();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "p3-beta",
          domain: "p3-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          created_at: baselineCreatedAt,
        },
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "p3-acme",
          domain: "p3-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          created_at: recentCreatedAt,
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const users = await svc
      .from("platform_users")
      .insert([
        {
          id: userA1.id,
          email: userA1.email,
          full_name: "A One",
          is_opollo_staff: false,
        },
        {
          id: userA2.id,
          email: userA2.email,
          full_name: "A Two",
          is_opollo_staff: false,
        },
        {
          id: userB1.id,
          email: userB1.email,
          full_name: "B One",
          is_opollo_staff: false,
        },
      ])
      .select("id");
    if (users.error) {
      throw new Error(
        `seed users: ${users.error.code ?? "?"} ${users.error.message}`,
      );
    }

    // A has 2 members, B has 1 — exercises the count-grouping logic.
    const memberships = await svc
      .from("platform_company_users")
      .insert([
        { company_id: COMPANY_A_ID, user_id: userA1.id, role: "admin" },
        { company_id: COMPANY_A_ID, user_id: userA2.id, role: "editor" },
        { company_id: COMPANY_B_ID, user_id: userB1.id, role: "admin" },
      ])
      .select("id");
    if (memberships.error) {
      throw new Error(
        `seed memberships: ${memberships.error.code ?? "?"} ${memberships.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    for (const u of [userA1, userA2, userB1]) {
      if (!u) continue;
      await svc.auth.admin.deleteUser(u.id);
    }
  });

  it("returns companies ordered by created_at desc with member counts", async () => {
    const result = await listPlatformCompanies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const onlyMine = result.data.companies.filter(
      (c) => c.id === COMPANY_A_ID || c.id === COMPANY_B_ID,
    );
    expect(onlyMine).toHaveLength(2);

    // A was inserted with the more-recent created_at, so it should come
    // first in the filtered slice. (Other companies seeded by the
    // migration may be present too; assertion is on relative order.)
    const idxA = onlyMine.findIndex((c) => c.id === COMPANY_A_ID);
    const idxB = onlyMine.findIndex((c) => c.id === COMPANY_B_ID);
    expect(idxA).toBeLessThan(idxB);

    const a = onlyMine[idxA]!;
    expect(a.name).toBe("Acme Co");
    expect(a.slug).toBe("p3-acme");
    expect(a.domain).toBe("p3-acme.test");
    expect(a.member_count).toBe(2);
    expect(a.is_opollo_internal).toBe(false);

    const b = onlyMine[idxB]!;
    expect(b.member_count).toBe(1);
  });

  it("returns member_count=0 for a company with no members", async () => {
    const svc = getServiceRoleClient();
    const emptyId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const insert = await svc
      .from("platform_companies")
      .insert({
        id: emptyId,
        name: "Empty Co",
        slug: "p3-empty",
        domain: null,
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
      })
      .select("id");
    expect(insert.error).toBeNull();

    const result = await listPlatformCompanies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const empty = result.data.companies.find((c) => c.id === emptyId);
    expect(empty).toBeDefined();
    expect(empty?.member_count).toBe(0);
  });

  it("includes the Opollo internal company when seeded", async () => {
    const svc = getServiceRoleClient();
    const opolloInternalId = "00000000-0000-0000-0000-000000000001";
    await svc
      .from("platform_companies")
      .insert({
        id: opolloInternalId,
        name: "Opollo",
        slug: "opollo",
        domain: null,
        is_opollo_internal: true,
        timezone: "Australia/Melbourne",
      });

    const result = await listPlatformCompanies();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const internal = result.data.companies.find(
      (c) => c.id === opolloInternalId,
    );
    expect(internal).toBeDefined();
    expect(internal?.is_opollo_internal).toBe(true);
  });
});
