/**
 * Unit tests for the two find-path fixes in autoAttachImage.
 *
 * Fix 1 — variant swap-don't-stack:
 *   When an existing draft already has an asset from the same source row
 *   (same batch_id + parent_post_index), the incoming asset REPLACES it
 *   rather than being appended. The prior asset row in social_media_assets
 *   is left intact (only media_asset_ids on the draft changes).
 *
 * Fix 2 — empty-shell caption + channel:
 *   When finding an existing draft whose content is "" and target_profiles
 *   is [], the find path fills both fields from the incoming job's
 *   post_text and resolved connections. Non-empty fields are left alone.
 *
 * Tests cover:
 *  FIX 1:
 *  - Prior variant present → asset replaced, not stacked
 *  - No prior variant (first approval for date) → normal append
 *  - No batch_id (standalone job) → normal append (legacy path unchanged)
 *  - Variant lookup error → fail-soft append
 *
 *  FIX 2:
 *  - Empty shell → content + target_profiles filled
 *  - Non-empty content → content left alone (operator text preserved)
 *  - Non-empty target_profiles → channels left alone
 *  - Both non-empty → neither touched
 *  - Empty shell but no postText → content stays ""
 *
 *  COMBINED:
 *  - Variant swap + shell fill both apply to a single find-path hit
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const JOB_ID          = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID      = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APPROVER_ID     = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DRAFT_ID        = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ASSET_ID        = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PRIOR_ASSET_ID  = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CONN_ID         = "11111111-1111-4111-8111-111111111111";
const BATCH_ID        = "22222222-2222-4222-8222-222222222222";
const PRIOR_JOB_ID    = "33333333-3333-4333-8333-333333333333";
const STORAGE_PATH    = "co/img.png";
const PRIOR_STORAGE   = "co/prior.png";

// ─── Captured DB state ────────────────────────────────────────────────────────

let capturedDraftUpdate: Record<string, unknown> | null = null;
let capturedMediaAssetIds: string[] | null = null;

// Configurable DB responses
let existingDraft: Record<string, unknown> | null = null;
let priorJobs: Array<{ result_storage_path: string }> = [];
let priorAssets: Array<{ id: string }> = [];
let socialConnectionsResult: Array<{ id: string; platform: string; display_name: string | null; avatar_url: string | null }> = [];
let priorJobsError: { message: string } | null = null;

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockFrom = vi.fn((table: string) => {
  if (table === "image_generation_jobs") {
    return {
      select() {
        const c: Record<string, unknown> = {};
        c["select"] = () => c;
        c["eq"] = () => c;
        c["neq"] = async () => ({
          data: priorJobsError ? null : priorJobs,
          error: priorJobsError,
        });
        c["maybeSingle"] = async () => ({
          data: {
            id: JOB_ID,
            company_id: COMPANY_ID,
            state: "completed",
            result_storage_path: STORAGE_PATH,
            target_publish_date: "2026-08-01",
            generation_params: { aspectRatio: "16x9" },
            post_text: "Test AI caption.",
            target_platforms: ["linkedin"],
            parent_post_index: 0,
            batch_id: BATCH_ID,
          },
          error: null,
        });
        return c;
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    };
  }

  if (table === "social_media_assets") {
    return {
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: ASSET_ID }, error: null }),
        }),
      }),
      select() {
        const c: Record<string, unknown> = {};
        c["select"] = () => c;
        c["in"] = async () => ({ data: priorAssets, error: null });
        return c;
      },
    };
  }

  if (table === "social_connections") {
    const c: Record<string, unknown> = {};
    c["select"] = () => c;
    c["eq"] = () => c;
    c["in"] = () => c;
    c["neq"] = async () => ({ data: socialConnectionsResult, error: null });
    return c;
  }

  if (table === "social_post_drafts") {
    let selectCallCount = 0;
    return {
      select(cols?: string) {
        selectCallCount++;
        const isMediaRead = cols?.includes("media_asset_ids") && !cols?.includes("content");
        const isFind = cols?.includes("content");
        const c: Record<string, unknown> = {};
        c["select"] = () => c;
        c["eq"] = () => c;
        c["is"] = () => c;
        c["limit"] = () => c;
        c["maybeSingle"] = async () => {
          if (isFind) return { data: existingDraft, error: null };
          if (isMediaRead) return {
            data: { media_asset_ids: existingDraft
              ? (existingDraft.media_asset_ids as string[] ?? [])
              : [] },
            error: null,
          };
          return { data: existingDraft, error: null };
        };
        return c;
      },
      insert(row: Record<string, unknown>) {
        return {
          select: () => ({
            single: async () => ({ data: { id: DRAFT_ID }, error: null }),
          }),
        };
      },
      update(patch: Record<string, unknown>) {
        capturedDraftUpdate = patch;
        if ("media_asset_ids" in patch) {
          capturedMediaAssetIds = patch.media_asset_ids as string[];
        }
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
  }

  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
  };
});

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

import { autoAttachImage } from "@/lib/image/auto-attach";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetState() {
  capturedDraftUpdate = null;
  capturedMediaAssetIds = null;
  existingDraft = null;
  priorJobs = [];
  priorAssets = [];
  socialConnectionsResult = [];
  priorJobsError = null;
}

function makeExistingDraft(overrides: Partial<{
  content: string;
  target_profiles: unknown[];
  draft_data: Record<string, unknown>;
  media_asset_ids: string[];
}> = {}) {
  return {
    id: DRAFT_ID,
    content: "",
    target_profiles: [],
    draft_data: {},
    media_asset_ids: [],
    ...overrides,
  };
}

const BASE_INPUT = { jobId: JOB_ID, companyId: COMPANY_ID, approvedBy: APPROVER_ID };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("autoAttachImage — find-path: Fix 1 (variant swap)", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => {
      if (table === "image_generation_jobs") {
        return {
          select() {
            const c: Record<string, unknown> = {};
            c["select"] = () => c;
            c["eq"] = () => c;
            c["neq"] = async () => ({ data: priorJobsError ? null : priorJobs, error: priorJobsError });
            c["maybeSingle"] = async () => ({
              data: { id: JOB_ID, company_id: COMPANY_ID, state: "completed", result_storage_path: STORAGE_PATH, target_publish_date: "2026-08-01", generation_params: { aspectRatio: "16x9" }, post_text: "Caption.", target_platforms: ["linkedin"], parent_post_index: 0, batch_id: BATCH_ID },
              error: null,
            });
            return c;
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "social_media_assets") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: ASSET_ID }, error: null }) }) }),
          select() { const c: Record<string, unknown> = {}; c["select"] = () => c; c["in"] = async () => ({ data: priorAssets, error: null }); return c; },
        };
      }
      if (table === "social_connections") {
        const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["in"] = () => c; c["neq"] = async () => ({ data: socialConnectionsResult, error: null }); return c;
      }
      if (table === "social_post_drafts") {
        return {
          select(cols?: string) {
            const isMediaRead = cols?.includes("media_asset_ids") && !cols?.includes("content");
            const c: Record<string, unknown> = {};
            c["select"] = () => c; c["eq"] = () => c; c["is"] = () => c; c["limit"] = () => c;
            c["maybeSingle"] = async () => {
              if (isMediaRead) return { data: { media_asset_ids: existingDraft?.media_asset_ids ?? [] }, error: null };
              return { data: existingDraft, error: null };
            };
            return c;
          },
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: DRAFT_ID }, error: null }) }) }),
          update(patch: Record<string, unknown>) {
            if ("media_asset_ids" in patch) capturedMediaAssetIds = patch.media_asset_ids as string[];
            else capturedDraftUpdate = patch;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });
  });

  it("prior variant present → REPLACES existing asset, does not stack", async () => {
    // Draft has prior variant asset already attached.
    existingDraft = makeExistingDraft({ media_asset_ids: [PRIOR_ASSET_ID] });
    // Prior job from same batch + row, already attached to this draft.
    priorJobs = [{ result_storage_path: PRIOR_STORAGE }];
    priorAssets = [{ id: PRIOR_ASSET_ID }];

    await autoAttachImage(BASE_INPUT);

    // Only the NEW asset remains; prior variant asset replaced.
    expect(capturedMediaAssetIds).toEqual([ASSET_ID]);
    expect(capturedMediaAssetIds).not.toContain(PRIOR_ASSET_ID);
  });

  it("no prior variant (first approval for date) → normal append", async () => {
    existingDraft = makeExistingDraft({ media_asset_ids: [] });
    priorJobs = []; // no prior variants attached

    await autoAttachImage(BASE_INPUT);

    expect(capturedMediaAssetIds).toEqual([ASSET_ID]);
  });

  it("no batch_id (standalone job) → falls back to plain append", async () => {
    // Reconfigure job to have no batch_id.
    mockFrom.mockImplementationOnce(() => ({
      select() {
        const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c;
        c["maybeSingle"] = async () => ({
          data: { id: JOB_ID, company_id: COMPANY_ID, state: "completed", result_storage_path: STORAGE_PATH, target_publish_date: "2026-08-01", generation_params: {}, post_text: null, target_platforms: [], parent_post_index: 0, batch_id: null },
          error: null,
        });
        return c;
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));

    existingDraft = makeExistingDraft({ media_asset_ids: ["other-asset"] });

    await autoAttachImage(BASE_INPUT);

    // Without batch_id, append normally.
    expect(capturedMediaAssetIds).toContain(ASSET_ID);
    expect(capturedMediaAssetIds).toContain("other-asset");
  });

  it("variant lookup error → fail-soft: appends normally", async () => {
    existingDraft = makeExistingDraft({ media_asset_ids: [PRIOR_ASSET_ID] });
    priorJobsError = { message: "DB timeout" };

    await autoAttachImage(BASE_INPUT);

    // Fail-soft: appends new asset even though lookup failed.
    expect(capturedMediaAssetIds).toContain(ASSET_ID);
    expect(capturedMediaAssetIds).toContain(PRIOR_ASSET_ID); // not removed (lookup failed)
  });
});

describe("autoAttachImage — find-path: Fix 2 (empty-shell fill)", () => {
  beforeEach(() => {
    resetState();
    vi.clearAllMocks();
    // Same mock setup as above; reuse the full implementation.
    mockFrom.mockImplementation((table: string) => {
      if (table === "image_generation_jobs") {
        return {
          select() {
            const c: Record<string, unknown> = {};
            c["select"] = () => c; c["eq"] = () => c; c["neq"] = async () => ({ data: [], error: null });
            c["maybeSingle"] = async () => ({
              data: { id: JOB_ID, company_id: COMPANY_ID, state: "completed", result_storage_path: STORAGE_PATH, target_publish_date: "2026-08-01", generation_params: { aspectRatio: "1x1" }, post_text: "AI caption for shell.", target_platforms: ["linkedin"], parent_post_index: 0, batch_id: BATCH_ID },
              error: null,
            });
            return c;
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "social_media_assets") {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: ASSET_ID }, error: null }) }) }), select() { const c: Record<string, unknown> = {}; c["select"] = () => c; c["in"] = async () => ({ data: [], error: null }); return c; } };
      }
      if (table === "social_connections") {
        const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["in"] = () => c; c["neq"] = async () => ({ data: socialConnectionsResult, error: null }); return c;
      }
      if (table === "social_post_drafts") {
        return {
          select(cols?: string) {
            const isMediaRead = cols?.includes("media_asset_ids") && !cols?.includes("content");
            const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["is"] = () => c; c["limit"] = () => c;
            c["maybeSingle"] = async () => {
              if (isMediaRead) return { data: { media_asset_ids: [] }, error: null };
              return { data: existingDraft, error: null };
            };
            return c;
          },
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: DRAFT_ID }, error: null }) }) }),
          update(patch: Record<string, unknown>) {
            if ("media_asset_ids" in patch) capturedMediaAssetIds = patch.media_asset_ids as string[];
            else capturedDraftUpdate = { ...(capturedDraftUpdate ?? {}), ...patch };
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });
  });

  it("empty shell → content + target_profiles both filled", async () => {
    existingDraft = makeExistingDraft({ content: "", target_profiles: [], draft_data: {} });
    socialConnectionsResult = [{ id: CONN_ID, platform: "linkedin_company", display_name: "Acme", avatar_url: null }];

    await autoAttachImage(BASE_INPUT);

    expect(capturedDraftUpdate?.content).toBe("AI caption for shell.");
    const profiles = capturedDraftUpdate?.target_profiles as Array<{ profile_id: string }>;
    expect(profiles?.some(p => p.profile_id === CONN_ID)).toBe(true);
    const dd = capturedDraftUpdate?.draft_data as { target_connection_ids?: string[] };
    expect(dd?.target_connection_ids).toContain(CONN_ID);
  });

  it("non-empty content → content left alone (operator text preserved)", async () => {
    existingDraft = makeExistingDraft({ content: "My custom caption.", target_profiles: [] });
    socialConnectionsResult = [{ id: CONN_ID, platform: "linkedin_company", display_name: "Acme", avatar_url: null }];

    await autoAttachImage(BASE_INPUT);

    // content must NOT be overwritten
    expect(capturedDraftUpdate?.content).toBeUndefined();
  });

  it("non-empty target_profiles → channels left alone", async () => {
    const existingProfile = { profile_id: "existing-profile", platform: "linkedin_personal" };
    existingDraft = makeExistingDraft({ content: "", target_profiles: [existingProfile] });
    socialConnectionsResult = [{ id: CONN_ID, platform: "linkedin_company", display_name: "Acme", avatar_url: null }];

    await autoAttachImage(BASE_INPUT);

    // target_profiles must NOT be overwritten
    expect(capturedDraftUpdate?.target_profiles).toBeUndefined();
    // content fill may still happen (content was empty)
    expect(capturedDraftUpdate?.content).toBe("AI caption for shell.");
  });

  it("both content + target_profiles non-empty → neither field touched", async () => {
    existingDraft = makeExistingDraft({
      content: "Operator wrote this.",
      target_profiles: [{ profile_id: "existing-profile" }],
    });
    socialConnectionsResult = [{ id: CONN_ID, platform: "linkedin_company", display_name: "Acme", avatar_url: null }];

    await autoAttachImage(BASE_INPUT);

    // No shell-fill patch should be sent at all.
    expect(capturedDraftUpdate?.content).toBeUndefined();
    expect(capturedDraftUpdate?.target_profiles).toBeUndefined();
  });

  it("empty shell but no post_text → content stays empty (no patch for content)", async () => {
    // Reconfigure job to have null post_text.
    mockFrom.mockImplementationOnce(() => ({
      select() {
        const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["neq"] = async () => ({ data: [], error: null });
        c["maybeSingle"] = async () => ({
          data: { id: JOB_ID, company_id: COMPANY_ID, state: "completed", result_storage_path: STORAGE_PATH, target_publish_date: "2026-08-01", generation_params: {}, post_text: null, target_platforms: ["linkedin"], parent_post_index: 0, batch_id: BATCH_ID },
          error: null,
        });
        return c;
      },
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }));

    existingDraft = makeExistingDraft({ content: "", target_profiles: [] });

    await autoAttachImage(BASE_INPUT);

    expect(capturedDraftUpdate?.content).toBeUndefined();
  });
});

describe("autoAttachImage — combined: variant swap + shell fill on same find hit", () => {
  it("prior variant present + empty shell → swap image AND fill caption+channels", async () => {
    vi.clearAllMocks();
    let capturedUpdates: Record<string, unknown>[] = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === "image_generation_jobs") {
        return {
          select() {
            const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c;
            c["neq"] = async () => ({ data: [{ result_storage_path: PRIOR_STORAGE }], error: null });
            c["maybeSingle"] = async () => ({
              data: { id: JOB_ID, company_id: COMPANY_ID, state: "completed", result_storage_path: STORAGE_PATH, target_publish_date: "2026-08-01", generation_params: { aspectRatio: "1x1" }, post_text: "Combined caption.", target_platforms: ["linkedin"], parent_post_index: 0, batch_id: BATCH_ID },
              error: null,
            });
            return c;
          },
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === "social_media_assets") {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: ASSET_ID }, error: null }) }) }),
          select() { const c: Record<string, unknown> = {}; c["select"] = () => c; c["in"] = async () => ({ data: [{ id: PRIOR_ASSET_ID }], error: null }); return c; },
        };
      }
      if (table === "social_connections") {
        const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["in"] = () => c; c["neq"] = async () => ({ data: [{ id: CONN_ID, platform: "linkedin_company", display_name: "Acme", avatar_url: null }], error: null }); return c;
      }
      if (table === "social_post_drafts") {
        return {
          select(cols?: string) {
            const isMediaRead = cols?.includes("media_asset_ids") && !cols?.includes("content");
            const c: Record<string, unknown> = {}; c["select"] = () => c; c["eq"] = () => c; c["is"] = () => c; c["limit"] = () => c;
            c["maybeSingle"] = async () => {
              if (isMediaRead) return { data: { media_asset_ids: [PRIOR_ASSET_ID] }, error: null };
              return { data: { id: DRAFT_ID, content: "", target_profiles: [], draft_data: {}, media_asset_ids: [PRIOR_ASSET_ID] }, error: null };
            };
            return c;
          },
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: DRAFT_ID }, error: null }) }) }),
          update(patch: Record<string, unknown>) {
            capturedUpdates.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    });

    await autoAttachImage(BASE_INPUT);

    // Shell fill update (content + target_profiles)
    const shellPatch = capturedUpdates.find(p => "content" in p);
    expect(shellPatch?.content).toBe("Combined caption.");
    const profiles = shellPatch?.target_profiles as Array<{ profile_id: string }> | undefined;
    expect(profiles?.some(p => p.profile_id === CONN_ID)).toBe(true);

    // Variant swap update (media_asset_ids)
    const mediaPatch = capturedUpdates.find(p => "media_asset_ids" in p);
    expect(mediaPatch?.media_asset_ids as string[]).toEqual([ASSET_ID]);
    expect((mediaPatch?.media_asset_ids as string[])).not.toContain(PRIOR_ASSET_ID);
  });
});
