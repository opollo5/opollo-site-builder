/**
 * Unit tests for Gap 2: target_profiles prefill on auto-created drafts.
 *
 * Tests cover:
 *  1. One matching connection → target_profiles + draft_data.target_connection_ids populated
 *  2. No matching connection → target_profiles: [], draft still created (graceful skip)
 *  3. Mixed (linkedin connected, facebook not) → only linkedin in target_profiles
 *  4. Business-over-personal preference: linkedin_company beats linkedin_personal
 *  5. Existing draft (find path) → NO INSERT called (create-only rule enforced)
 *  6. Both linkedin variants + facebook → 2 entries, personal excluded
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Shared test state (captured by mock closures) ────────────────────────────

let capturedDraftInsert: Record<string, unknown> | null = null;
let existingDraftForDate: { id: string } | null = null;
let socialConnectionsResult: Array<{ id: string; platform: string; display_name: string | null; avatar_url: string | null }> = [];

// ─── Supabase mock — full chain supporting all operations in autoAttachImage ──

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from(table: string) {
      // image_generation_jobs: load job (select chain) + markJobAttachState (update chain)
      if (table === "image_generation_jobs") {
        return {
          select() {
            const c: Record<string, unknown> = {};
            c["select"] = () => c;
            c["eq"] = () => c;
            c["maybeSingle"] = async () => ({
              data: {
                id: JOB_ID,
                company_id: COMPANY_ID,
                state: "completed",
                result_storage_path: STORAGE_PATH,
                target_publish_date: "2026-07-01",
                generation_params: { aspectRatio: "1x1" },
                post_text: "Test caption.",
                target_platforms: ["linkedin", "facebook"],
              },
              error: null,
            });
            return c;
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }

      // social_media_assets: insert asset row
      if (table === "social_media_assets") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: ASSET_ID }, error: null }),
            }),
          }),
        };
      }

      // social_connections: lookup company's connected accounts
      if (table === "social_connections") {
        const c: Record<string, unknown> = {};
        c["select"] = () => c;
        c["eq"] = () => c;
        c["in"] = () => c;
        c["neq"] = async () => ({ data: socialConnectionsResult, error: null });
        return c;
      }

      // social_post_drafts: find-or-create draft + read media_asset_ids + update media_asset_ids
      // Distinguish the two SELECT calls by the columns requested:
      //   "id"             → draft lookup (find-or-create)
      //   "media_asset_ids"→ read-before-update (Step 3 in autoAttachImage)
      if (table === "social_post_drafts") {
        return {
          select(cols?: string) {
            const isMediaRead = cols?.includes("media_asset_ids");
            const c: Record<string, unknown> = {};
            c["select"] = () => c;
            c["eq"] = () => c;
            c["is"] = () => c;
            c["limit"] = () => c;
            c["maybeSingle"] = async () => ({
              data: isMediaRead ? { media_asset_ids: [] } : existingDraftForDate,
              error: null,
            });
            return c;
          },
          insert(row: Record<string, unknown>) {
            capturedDraftInsert = row;
            return {
              select: () => ({
                single: async () => ({ data: { id: NEW_DRAFT_ID }, error: null }),
              }),
            };
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }

      // Fallthrough: return a no-op chain
      const noop: Record<string, unknown> = {};
      noop["select"] = () => noop;
      noop["eq"] = () => noop;
      noop["update"] = () => ({ eq: () => Promise.resolve({ error: null }) });
      noop["maybeSingle"] = async () => ({ data: null, error: null });
      return noop;
    },
  })),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { autoAttachImage } from "@/lib/image/auto-attach";

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID       = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPROVER_ID  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEW_DRAFT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const EXISTING_DRAFT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ASSET_ID     = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const STORAGE_PATH = "co/img.png";

const LI_PERSONAL_ID = "11111111-1111-4111-8111-111111111111";
const LI_COMPANY_ID  = "22222222-2222-4222-8222-222222222222";
const FB_PAGE_ID     = "33333333-3333-4333-8333-333333333333";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("autoAttachImage — target_profiles prefill (Gap 2)", () => {
  beforeEach(() => {
    capturedDraftInsert = null;
    existingDraftForDate = null;
    socialConnectionsResult = [];
    vi.clearAllMocks();
  });

  it("one matching connection → target_profiles and draft_data.target_connection_ids populated", async () => {
    socialConnectionsResult = [
      { id: LI_COMPANY_ID, platform: "linkedin_company", display_name: "Acme Ltd", avatar_url: null },
    ];

    const result = await autoAttachImage({
      jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    expect(capturedDraftInsert).not.toBeNull();

    const profiles = capturedDraftInsert!.target_profiles as Array<{ profile_id: string; platform: string }>;
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profile_id).toBe(LI_COMPANY_ID);
    expect(profiles[0]!.platform).toBe("linkedin_company");

    const draftData = capturedDraftInsert!.draft_data as { target_connection_ids: string[] };
    expect(draftData.target_connection_ids).toEqual([LI_COMPANY_ID]);
  });

  it("no matching connection → target_profiles: [], draft created without channels", async () => {
    socialConnectionsResult = [];

    const result = await autoAttachImage({
      jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    expect(capturedDraftInsert).not.toBeNull();
    expect(capturedDraftInsert!.target_profiles).toEqual([]);
    const dd = capturedDraftInsert!.draft_data as Record<string, unknown>;
    expect(dd.target_connection_ids).toBeUndefined();
  });

  it("mixed: linkedin connected, facebook not → only linkedin in target_profiles", async () => {
    socialConnectionsResult = [
      { id: LI_COMPANY_ID, platform: "linkedin_company", display_name: "Acme Ltd", avatar_url: null },
      // No facebook_page — not connected
    ];

    await autoAttachImage({ jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID });

    const profiles = capturedDraftInsert!.target_profiles as Array<{ profile_id: string }>;
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.profile_id).toBe(LI_COMPANY_ID);
  });

  it("business-over-personal: linkedin_company preferred over linkedin_personal", async () => {
    // Both variants connected — company must win (per baked-in preference)
    socialConnectionsResult = [
      { id: LI_PERSONAL_ID, platform: "linkedin_personal", display_name: "Alice", avatar_url: null },
      { id: LI_COMPANY_ID,  platform: "linkedin_company",  display_name: "Acme",  avatar_url: null },
    ];

    await autoAttachImage({ jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID });

    const profiles = capturedDraftInsert!.target_profiles as Array<{ profile_id: string }>;
    const linkedinIds = profiles
      .map((p) => p.profile_id)
      .filter((id) => id === LI_COMPANY_ID || id === LI_PERSONAL_ID);
    // Exactly one linkedin entry, and it must be the company page
    expect(linkedinIds).toHaveLength(1);
    expect(linkedinIds[0]).toBe(LI_COMPANY_ID);
  });

  it("always-create: every approval INSERTs its own draft (never finds existing)", async () => {
    // There is no find-existing logic anymore. Even if a draft for this date
    // already exists, a second approval always creates a new one.
    socialConnectionsResult = [
      { id: LI_COMPANY_ID, platform: "linkedin_company", display_name: "Acme", avatar_url: null },
    ];

    const result = await autoAttachImage({
      jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID,
    });

    expect(result.state).toBe("attached");
    // Always inserts — capturedDraftInsert is populated.
    expect(capturedDraftInsert).not.toBeNull();
    // target_profiles populated on the INSERT.
    const profiles = capturedDraftInsert!.target_profiles as Array<{ profile_id: string }>;
    expect(profiles.some(p => p.profile_id === LI_COMPANY_ID)).toBe(true);
  });

  it("both linkedin variants + facebook → 2 entries, personal excluded", async () => {
    socialConnectionsResult = [
      { id: LI_PERSONAL_ID, platform: "linkedin_personal", display_name: "Alice",   avatar_url: null },
      { id: LI_COMPANY_ID,  platform: "linkedin_company",  display_name: "Acme",    avatar_url: null },
      { id: FB_PAGE_ID,     platform: "facebook_page",     display_name: "Acme FB", avatar_url: null },
    ];

    await autoAttachImage({ jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID });

    const profiles = capturedDraftInsert!.target_profiles as Array<{ profile_id: string }>;
    const ids = profiles.map((p) => p.profile_id);
    expect(ids).toContain(LI_COMPANY_ID);   // company page selected
    expect(ids).toContain(FB_PAGE_ID);      // facebook included
    expect(ids).not.toContain(LI_PERSONAL_ID); // personal excluded
    expect(ids).toHaveLength(2);
  });
});
