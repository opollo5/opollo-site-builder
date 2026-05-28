import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  cancelScheduleEntry,
  createScheduleEntry,
  listScheduleEntries,
} from "@/lib/platform/social/scheduling";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-14 — schedule entries lib (V2 — social_post_drafts).
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

  // Helper: insert a V2 draft in 'scheduled' state (bypasses the full
  // submit/approve dance — those flows are tested elsewhere).
  async function createScheduledDraft(companyId = COMPANY_A_ID): Promise<string> {
    const svc = getServiceRoleClient();
    const draftId = crypto.randomUUID();
    const { error } = await svc.from("social_post_drafts").insert({
      id: draftId,
      company_id: companyId,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content: "ready to schedule",
      media_urls: [],
      target_profiles: [],
    });
    if (error) throw new Error(`createScheduledDraft: ${error.message}`);
    return draftId;
  }

  function futureIso(daysFromNow = 7): string {
    return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  }

  describe("createScheduleEntry", () => {
    it("happy path — sets scheduled_at on draft", async () => {
      const postId = await createScheduledDraft();
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
    });

    it("rejects past scheduled_at", async () => {
      const postId = await createScheduledDraft();
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

    it("rejects scheduling a non-scheduled draft with INVALID_STATE", async () => {
      const svc = getServiceRoleClient();
      const draftId = crypto.randomUUID();
      await svc.from("social_post_drafts").insert({
        id: draftId,
        company_id: COMPANY_A_ID,
        created_by: creator.id,
        updated_by: creator.id,
        state: "pending_approval",
        content: "not yet approved",
        media_urls: [],
        target_profiles: [],
      });

      const result = await createScheduleEntry({
        postMasterId: draftId,
        companyId: COMPANY_A_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(),
        scheduledBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("INVALID_STATE");
    });

    it("allows scheduling on different platforms (updates scheduled_at each time)", async () => {
      const postId = await createScheduledDraft();
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

    it("returns NOT_FOUND for cross-company access", async () => {
      const postId = await createScheduledDraft();
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
    it("returns NOT_FOUND for cross-company access", async () => {
      const postId = await createScheduledDraft();
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
    it("happy path — sets cancelled_at, second cancel returns INVALID_STATE", async () => {
      const postId = await createScheduledDraft();
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
      const postId = await createScheduledDraft();
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
