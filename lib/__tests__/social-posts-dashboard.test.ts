import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPostMaster,
  getSocialPostsStats,
} from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-11: dashboard stats.
//
// Verifies counts per state + cross-company isolation + the "approved
// this week" 7-day window.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa1111";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb1111";

describe("lib/platform/social/posts/dashboard", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-11-creator@opollo.test",
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
          slug: "s1-11-acme",
          domain: "s1-11-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-11-beta",
          domain: "s1-11-beta.test",
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

    const membership = await svc
      .from("platform_company_users")
      .insert({
        company_id: COMPANY_A_ID,
        user_id: creator.id,
        role: "editor",
      })
      .select("id");
    if (membership.error) {
      throw new Error(
        `seed membership: ${membership.error.code ?? "?"} ${membership.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  it("returns zeroes for an empty company", async () => {
    const result = await getSocialPostsStats({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      drafts: 0,
      awaitingApproval: 0,
      approved: 0,
      scheduled: 0,
      published: 0,
      approvedThisWeek: 0,
    });
  });

  it("counts posts per state correctly", async () => {
    // Two drafts via the lib (created_by + state defaults work).
    await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "draft 1",
      createdBy: creator.id,
    });
    await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "draft 2",
      createdBy: creator.id,
    });

    // Force three more posts into different states directly.
    const svc = getServiceRoleClient();
    await svc.from("social_post_master").insert([
      {
        company_id: COMPANY_A_ID,
        master_text: "p1",
        state: "pending_client_approval",
        source_type: "manual",
      },
      {
        company_id: COMPANY_A_ID,
        master_text: "p2",
        state: "approved",
        source_type: "manual",
      },
      {
        company_id: COMPANY_A_ID,
        master_text: "p3",
        state: "scheduled",
        source_type: "manual",
      },
      {
        company_id: COMPANY_A_ID,
        master_text: "p4",
        state: "published",
        source_type: "manual",
      },
    ]);

    const result = await getSocialPostsStats({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.drafts).toBe(2);
    expect(result.data.awaitingApproval).toBe(1);
    expect(result.data.approved).toBe(1);
    expect(result.data.scheduled).toBe(1);
    expect(result.data.published).toBe(1);
  });

  it("isolates company A from company B's posts", async () => {
    await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "A draft",
      createdBy: creator.id,
    });

    // Insert posts into company B directly (creator isn't a member).
    const svc = getServiceRoleClient();
    await svc.from("social_post_master").insert([
      {
        company_id: COMPANY_B_ID,
        master_text: "B p1",
        state: "draft",
        source_type: "manual",
      },
      {
        company_id: COMPANY_B_ID,
        master_text: "B p2",
        state: "approved",
        source_type: "manual",
      },
    ]);

    const aStats = await getSocialPostsStats({ companyId: COMPANY_A_ID });
    expect(aStats.ok).toBe(true);
    if (!aStats.ok) return;
    expect(aStats.data.drafts).toBe(1);
    expect(aStats.data.approved).toBe(0); // B's approved doesn't count

    const bStats = await getSocialPostsStats({ companyId: COMPANY_B_ID });
    expect(bStats.ok).toBe(true);
    if (!bStats.ok) return;
    expect(bStats.data.drafts).toBe(1);
    expect(bStats.data.approved).toBe(1);
  });

  it("approvedThisWeek counts only approvals within the 7-day window", async () => {
    const svc = getServiceRoleClient();
    const now = new Date();
    const eightDaysAgo = new Date(
      now.getTime() - 8 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const yesterday = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();

    // Two approved posts: one stamped 8 days ago, one stamped yesterday.
    // The trigger track_post_state_change auto-updates state_changed_at
    // on UPDATE, so we INSERT with both fields set, no later UPDATE.
    await svc.from("social_post_master").insert([
      {
        company_id: COMPANY_A_ID,
        master_text: "old approved",
        state: "approved",
        source_type: "manual",
        state_changed_at: eightDaysAgo,
      },
      {
        company_id: COMPANY_A_ID,
        master_text: "recent approved",
        state: "approved",
        source_type: "manual",
        state_changed_at: yesterday,
      },
    ]);

    const result = await getSocialPostsStats({ companyId: COMPANY_A_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.approved).toBe(2); // both count toward total
    expect(result.data.approvedThisWeek).toBe(1); // only the recent one
  });
});
