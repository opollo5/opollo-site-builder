import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { createPostMaster } from "@/lib/platform/social/posts";
import {
  cancelScheduleEntry,
  createScheduleEntry,
  listScheduleEntries,
} from "@/lib/platform/social/scheduling";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-14 — schedule entries lib.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa3333";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb3333";

describe("lib/platform/social/scheduling", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-14-creator@opollo.test",
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
          slug: "s1-14-acme",
          domain: "s1-14-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-14-beta",
          domain: "s1-14-beta.test",
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
        role: "approver",
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

  // Helper: create an approved post (bypasses the full submit/decide
  // dance — those flows are tested elsewhere).
  async function createApprovedPost(): Promise<string> {
    const post = await createPostMaster({
      companyId: COMPANY_A_ID,
      masterText: "ready to schedule",
      createdBy: creator.id,
    });
    if (!post.ok) throw new Error(`createApprovedPost: ${post.error.code}`);
    const svc = getServiceRoleClient();
    await svc
      .from("social_post_master")
      .update({ state: "approved" })
      .eq("id", post.data.id);
    return post.data.id;
  }

  function futureIso(daysFromNow = 7): string {
    return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  }

  describe("createScheduleEntry", () => {
    it("happy path — creates entry, auto-creates variant row", async () => {
      const postId = await createApprovedPost();
      const result = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(7),
        scheduledBy: creator.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.platform).toBe("linkedin_personal");
      expect(result.data.cancelled_at).toBeNull();
      expect(result.data.scheduled_by).toBe(creator.id);

      // Variant row should have been auto-created.
      const svc = getServiceRoleClient();
      const variant = await svc
        .from("social_post_variant")
        .select("is_custom")
        .eq("post_master_id", postId)
        .eq("platform", "linkedin_personal")
        .single();
      expect(variant.error).toBeNull();
      expect(variant.data?.is_custom).toBe(false);
    });

    it("rejects past scheduled_at", async () => {
      const postId = await createApprovedPost();
      const result = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "x",
        scheduledAt: new Date(Date.now() - 1000).toISOString(),
        scheduledBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects scheduling a draft post with INVALID_STATE", async () => {
      const post = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "still draft",
        createdBy: creator.id,
      });
      expect(post.ok).toBe(true);
      if (!post.ok) return;

      const result = await createScheduleEntry({
        postMasterId: post.data.id,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(),
        scheduledBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("rejects double-scheduling the same platform with INVALID_STATE", async () => {
      const postId = await createApprovedPost();
      const first = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "facebook_page",
        scheduledAt: futureIso(7),
        scheduledBy: creator.id,
      });
      expect(first.ok).toBe(true);

      const second = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "facebook_page",
        scheduledAt: futureIso(8),
        scheduledBy: creator.id,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("INVALID_STATE");
    });

    it("allows scheduling on different platforms simultaneously", async () => {
      const postId = await createApprovedPost();
      const a = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(5),
        scheduledBy: creator.id,
      });
      const b = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "x",
        scheduledAt: futureIso(6),
        scheduledBy: creator.id,
      });
      expect(a.ok && b.ok).toBe(true);
    });

    it("allows re-scheduling after cancellation", async () => {
      const postId = await createApprovedPost();
      const first = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "gbp",
        scheduledAt: futureIso(3),
        scheduledBy: creator.id,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const cancelled = await cancelScheduleEntry({
        entryId: first.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(cancelled.ok).toBe(true);

      const reschedule = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "gbp",
        scheduledAt: futureIso(10),
        scheduledBy: creator.id,
      });
      expect(reschedule.ok).toBe(true);
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const postId = await createApprovedPost();
      const result = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_B_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(),
        scheduledBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("listScheduleEntries", () => {
    it("returns active entries ordered by scheduled_at asc", async () => {
      const postId = await createApprovedPost();
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(10),
        scheduledBy: creator.id,
      });
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "x",
        scheduledAt: futureIso(3),
        scheduledBy: creator.id,
      });

      const result = await listScheduleEntries({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries.length).toBe(2);
      // x first (sooner), linkedin second.
      expect(result.data.entries[0]?.platform).toBe("x");
      expect(result.data.entries[1]?.platform).toBe("linkedin_personal");
    });

    it("excludes cancelled entries by default", async () => {
      const postId = await createApprovedPost();
      const created = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(),
        scheduledBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await cancelScheduleEntry({
        entryId: created.data.id,
        companyId: COMPANY_A_ID,
      });

      const result = await listScheduleEntries({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries).toEqual([]);

      const withCancelled = await listScheduleEntries({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        includeCancelled: true,
      });
      expect(withCancelled.ok).toBe(true);
      if (!withCancelled.ok) return;
      expect(withCancelled.data.entries.length).toBe(1);
      expect(withCancelled.data.entries[0]?.cancelled_at).not.toBeNull();
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const postId = await createApprovedPost();
      const result = await listScheduleEntries({
        postMasterId: postId,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("cancelScheduleEntry", () => {
    it("happy path — sets cancelled_at, idempotent on repeat", async () => {
      const postId = await createApprovedPost();
      const created = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(),
        scheduledBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const first = await cancelScheduleEntry({
        entryId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.cancelled_at).not.toBeNull();

      const second = await cancelScheduleEntry({
        entryId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const postId = await createApprovedPost();
      const created = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(),
        scheduledBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await cancelScheduleEntry({
        entryId: created.data.id,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND for missing entry id", async () => {
      const result = await cancelScheduleEntry({
        entryId: "00000000-0000-0000-0000-000000000fff",
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });
});
