import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// Regression — P0: Calendar-view Redis cache hides newly-scheduled posts.
//
// When a post is scheduled via the composer, swrMutate triggers a refetch of
// calendar-view. The bug: the Redis server cache (30s TTL) served stale data
// to the SWR client, permanently hiding the new post.
//
// Fix: Redis caching removed from calendar-view/route.ts. The endpoint is
// force-dynamic; SWR dedupingInterval:30s provides sufficient coalescing.
//
// This test verifies:
//   1. A newly-inserted scheduled draft falls within the expected date range
//      (i.e., the DB query that underpins the route returns it immediately).
//   2. Cross-company isolation: the draft does not appear when querying for a
//      different company.
// ---------------------------------------------------------------------------

const COMPANY_CALV_ID = "cad00000-0000-0000-0000-ca1e00000001";
const COMPANY_OTHER_ID = "cad00000-0000-0000-0000-ca1e00000002";

const FROM = "2026-05-01";
const TO = "2026-05-31";

describe("calendar-view — scheduled draft appears immediately after insert (P0 regression)", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "calv-p0-regression@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    await svc.from("platform_companies").insert([
      {
        id: COMPANY_CALV_ID,
        name: "CalView Co",
        slug: "calv-p0-calview",
        domain: "calv-p0-calview.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      },
      {
        id: COMPANY_OTHER_ID,
        name: "Other Co",
        slug: "calv-p0-other",
        domain: "calv-p0-other.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      },
    ]);

    await svc.from("platform_users").insert({
      id: creator.id,
      email: creator.email,
      full_name: "CalView Creator",
      is_opollo_staff: false,
    });

    await svc.from("platform_company_users").insert([
      { company_id: COMPANY_CALV_ID, user_id: creator.id, role: "approver" },
      { company_id: COMPANY_OTHER_ID, user_id: creator.id, role: "approver" },
    ]);
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  // Mirrors the date-range + isolation logic in
  // app/api/platform/social/drafts/calendar-view/route.ts.
  // Selects only the columns that existed before the v3.2 polish PRs
  // so the test passes on CI environments at any migration level.
  async function queryCalendarView(companyId: string): Promise<Array<{ id: string }>> {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("social_post_drafts")
      .select("id, state, scheduled_at, published_at")
      .eq("company_id", companyId)
      .is("archived_at", null)
      .or(`scheduled_at.gte.${FROM},published_at.gte.${FROM}`)
      .or(`scheduled_at.lte.${TO}T23:59:59Z,published_at.lte.${TO}T23:59:59Z`)
      .order("scheduled_at", { ascending: true })
      .limit(200);

    if (error) throw new Error(`calendar query failed: ${error.message}`);
    return (data ?? []) as Array<{ id: string }>;
  }

  it("newly-inserted scheduled draft appears immediately in calendar query", async () => {
    const svc = getServiceRoleClient();

    const draftId = crypto.randomUUID();
    const { error: insertErr } = await svc.from("social_post_drafts").insert({
      id: draftId,
      company_id: COMPANY_CALV_ID,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content: "P0 regression test post",
      media_urls: [],
      target_profiles: [],
      platform_variants: {},
      scheduled_at: "2026-05-29T09:00:00Z",
      approval_required: false,
    });
    expect(insertErr).toBeNull();

    // No cache layer between insert and query — should appear immediately.
    const rows = await queryCalendarView(COMPANY_CALV_ID);
    const found = rows.find((r) => r.id === draftId);
    expect(found).toBeDefined();
  });

  it("newly-inserted draft is NOT returned when querying a different company", async () => {
    const svc = getServiceRoleClient();

    const draftId = crypto.randomUUID();
    const { error: insertErr } = await svc.from("social_post_drafts").insert({
      id: draftId,
      company_id: COMPANY_CALV_ID,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content: "Cross-company isolation test",
      media_urls: [],
      target_profiles: [],
      platform_variants: {},
      scheduled_at: "2026-05-15T10:00:00Z",
      approval_required: false,
    });
    expect(insertErr).toBeNull();

    // Other company should not see COMPANY_CALV_ID's draft.
    const rows = await queryCalendarView(COMPANY_OTHER_ID);
    const found = rows.find((r) => r.id === draftId);
    expect(found).toBeUndefined();
  });

  it("draft scheduled outside the date range is not returned", async () => {
    const svc = getServiceRoleClient();

    const draftId = crypto.randomUUID();
    const { error: insertErr } = await svc.from("social_post_drafts").insert({
      id: draftId,
      company_id: COMPANY_CALV_ID,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content: "Future month post",
      media_urls: [],
      target_profiles: [],
      platform_variants: {},
      scheduled_at: "2026-07-01T09:00:00Z", // July — outside May range
      approval_required: false,
    });
    expect(insertErr).toBeNull();

    const rows = await queryCalendarView(COMPANY_CALV_ID);
    const found = rows.find((r) => r.id === draftId);
    expect(found).toBeUndefined();
  });

  it("archived draft is excluded even when scheduled_at is in range", async () => {
    const svc = getServiceRoleClient();

    const draftId = crypto.randomUUID();
    const { error: insertErr } = await svc.from("social_post_drafts").insert({
      id: draftId,
      company_id: COMPANY_CALV_ID,
      created_by: creator.id,
      updated_by: creator.id,
      state: "scheduled",
      content: "Archived post",
      media_urls: [],
      target_profiles: [],
      platform_variants: {},
      scheduled_at: "2026-05-10T09:00:00Z",
      archived_at: "2026-05-10T08:00:00Z",
      approval_required: false,
    });
    expect(insertErr).toBeNull();

    const rows = await queryCalendarView(COMPANY_CALV_ID);
    const found = rows.find((r) => r.id === draftId);
    expect(found).toBeUndefined();
  });
});
