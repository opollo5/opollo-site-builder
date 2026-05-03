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
  createScheduleEntry,
  cancelScheduleEntry,
  listCompanyScheduleEntries,
} from "@/lib/platform/social/scheduling";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-25 — listCompanyScheduleEntries (calendar view lib).
// ---------------------------------------------------------------------------

const COMPANY_CAL_ID = "caddd000-0000-0000-0000-ca1enda000001";

describe("lib/platform/social/scheduling/list-company", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-25-calendar@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const co = await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_CAL_ID,
        name: "Calendar Co",
        slug: "s1-25-calco",
        domain: "s1-25-calco.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      })
      .select("id");
    if (co.error) throw new Error(`seed company: ${co.error.message}`);

    const usr = await svc
      .from("platform_users")
      .insert({
        id: creator.id,
        email: creator.email,
        full_name: "Calendar Creator",
        is_opollo_staff: false,
      })
      .select("id");
    if (usr.error) throw new Error(`seed user: ${usr.error.message}`);

    const mem = await svc
      .from("platform_company_users")
      .insert({
        company_id: COMPANY_CAL_ID,
        user_id: creator.id,
        role: "approver",
      })
      .select("id");
    if (mem.error) throw new Error(`seed membership: ${mem.error.message}`);
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  async function createApprovedPost(masterText = "hello world"): Promise<string> {
    const post = await createPostMaster({
      companyId: COMPANY_CAL_ID,
      masterText,
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

  function windowArgs(days = 30) {
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return { fromIso: now.toISOString(), toIso: end.toISOString() };
  }

  describe("validation", () => {
    it("rejects missing companyId", async () => {
      const r = await listCompanyScheduleEntries({
        companyId: "",
        ...windowArgs(),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects missing fromIso", async () => {
      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        fromIso: "",
        toIso: futureIso(),
      });
      expect(r.ok).toBe(false);
    });

    it("rejects invalid fromIso", async () => {
      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        fromIso: "not-a-date",
        toIso: futureIso(),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects fromIso > toIso", async () => {
      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        fromIso: futureIso(10),
        toIso: futureIso(1),
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("happy path", () => {
    it("returns [] when company has no posts", async () => {
      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.entries).toEqual([]);
    });

    it("returns scheduled entries in window ordered by scheduled_at asc", async () => {
      const postId = await createApprovedPost("First post");
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(10),
        scheduledBy: creator.id,
      });
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "x",
        scheduledAt: futureIso(3),
        scheduledBy: creator.id,
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(30),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.entries.length).toBeGreaterThanOrEqual(2);
      // First entry is the sooner one (x at +3d).
      const entryPlatforms = r.data.entries.map((e) => e.platform);
      expect(entryPlatforms.indexOf("x")).toBeLessThan(
        entryPlatforms.indexOf("linkedin_personal"),
      );
    });

    it("includes post_master_id and preview on each entry", async () => {
      const postId = await createApprovedPost("Hello from calendar");
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "facebook_page",
        scheduledAt: futureIso(5),
        scheduledBy: creator.id,
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const entry = r.data.entries.find((e) => e.post_master_id === postId);
      expect(entry).toBeDefined();
      expect(entry?.platform).toBe("facebook_page");
      expect(entry?.preview).toBe("Hello from calendar");
    });

    it("truncates preview at 80 chars with ellipsis", async () => {
      const longText = "A".repeat(100);
      const postId = await createApprovedPost(longText);
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "gbp",
        scheduledAt: futureIso(2),
        scheduledBy: creator.id,
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const entry = r.data.entries.find((e) => e.post_master_id === postId);
      expect(entry?.preview).toMatch(/^A{80}…$/);
    });

    it("excludes cancelled entries by default", async () => {
      const postId = await createApprovedPost("cancelled post");
      const created = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "x",
        scheduledAt: futureIso(4),
        scheduledBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await cancelScheduleEntry({
        entryId: created.data.id,
        companyId: COMPANY_CAL_ID,
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const found = r.data.entries.find((e) => e.post_master_id === postId);
      expect(found).toBeUndefined();
    });

    it("includes cancelled entries when includeCancelled=true", async () => {
      const postId = await createApprovedPost("will be cancelled");
      const created = await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "linkedin_company",
        scheduledAt: futureIso(6),
        scheduledBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await cancelScheduleEntry({
        entryId: created.data.id,
        companyId: COMPANY_CAL_ID,
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        fromIso: new Date().toISOString(),
        toIso: futureIso(30),
        includeCancelled: true,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const entry = r.data.entries.find((e) => e.post_master_id === postId);
      expect(entry).toBeDefined();
      expect(entry?.cancelled_at).not.toBeNull();
    });

    it("excludes entries outside the time window", async () => {
      const postId = await createApprovedPost("far future post");
      await createScheduleEntry({
        postMasterId: postId,
        companyId: COMPANY_CAL_ID,
        platform: "linkedin_personal",
        scheduledAt: futureIso(60),
        scheduledBy: creator.id,
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(30),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const found = r.data.entries.find((e) => e.post_master_id === postId);
      expect(found).toBeUndefined();
    });
  });
});
