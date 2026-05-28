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
  listCompanyScheduleEntries,
} from "@/lib/platform/social/scheduling";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-25 — listCompanyScheduleEntries (calendar view lib).
// V2: seeds social_post_drafts directly; no V1 tables.
// ---------------------------------------------------------------------------

const COMPANY_CAL_ID = "caddd000-0000-0000-0000-0000ca1e0001";

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

  async function createScheduledDraft(
    content = "hello world",
    options: { scheduledAt?: string; platform?: string } = {},
  ): Promise<string> {
    const svc = getServiceRoleClient();
    const draftId = crypto.randomUUID();
    const profileId = crypto.randomUUID();
    const profiles = options.platform
      ? [{ profile_id: profileId, platform: options.platform }]
      : [];
    const { error } = await svc.from("social_post_drafts").insert({
      id: draftId,
      company_id: COMPANY_CAL_ID,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content,
      media_urls: [],
      target_profiles: profiles,
      scheduled_at: options.scheduledAt ?? futureIso(7),
    });
    if (error) throw new Error(`createScheduledDraft: ${error.message}`);
    return draftId;
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
      await createScheduledDraft("First post", {
        scheduledAt: futureIso(10),
        platform: "linkedin_personal",
      });
      await createScheduledDraft("Second post", {
        scheduledAt: futureIso(3),
        platform: "x",
      });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(30),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.entries.length).toBeGreaterThanOrEqual(2);
      // x is at +3d, linkedin is at +10d — x must come first.
      const entryPlatforms = r.data.entries.map((e) => e.platform);
      expect(entryPlatforms.indexOf("x")).toBeLessThan(
        entryPlatforms.indexOf("linkedin_personal"),
      );
    });

    it("includes post_master_id and preview on each entry", async () => {
      const postId = await createScheduledDraft("Hello from calendar", {
        platform: "facebook_page",
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
      const postId = await createScheduledDraft(longText, { platform: "gbp" });

      const r = await listCompanyScheduleEntries({
        companyId: COMPANY_CAL_ID,
        ...windowArgs(),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const entry = r.data.entries.find((e) => e.post_master_id === postId);
      expect(entry?.preview).toMatch(/^A{80}…$/);
    });

    it("excludes cancelled entries — cancel clears scheduled_at, removing from calendar", async () => {
      const postId = await createScheduledDraft("cancelled post", {
        platform: "x",
        scheduledAt: futureIso(4),
      });

      await cancelScheduleEntry({
        entryId: postId,
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

    it("cancelled entries do not appear even with includeCancelled=true (V2 semantic)", async () => {
      const postId = await createScheduledDraft("will be cancelled", {
        platform: "linkedin_company",
        scheduledAt: futureIso(6),
      });

      await cancelScheduleEntry({
        entryId: postId,
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
      // V2: cancel → pending_approval, scheduled_at cleared → not in window.
      const entry = r.data.entries.find((e) => e.post_master_id === postId);
      expect(entry).toBeUndefined();
    });

    it("excludes entries outside the time window", async () => {
      const postId = await createScheduledDraft("far future post", {
        platform: "linkedin_personal",
        scheduledAt: futureIso(60),
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
