/**
 * Unit tests for calendar-view thumbnail resolution (media_asset_ids → signed URL).
 *
 * Tests cover:
 *  - Draft with media_asset_ids and no media_urls → primary_media_url from signed URL
 *  - Legacy draft (media_urls only) → primary_media_url from media_urls (unchanged)
 *  - Draft with both → legacy media_urls takes precedence (no resolution needed)
 *  - Fail-soft: asset lookup error → primary_media_url null, calendar still loads
 *  - No media at all → primary_media_url null
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Auth gate ────────────────────────────────────────────────────────────────
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn().mockResolvedValue({ kind: "allow", userId: "user-1" }),
}));

// ─── Supabase ─────────────────────────────────────────────────────────────────
const COMPANY_ID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_ID_1   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STORAGE_PATH = "co/template-composite/img.png";
const SIGNED_URL   = "https://proj.supabase.co/storage/v1/object/sign/generated-images/co/img.png?token=abc";
const LEGACY_URL   = "https://cdn.example.com/legacy.jpg";

let mockDrafts: Array<Record<string, unknown>> = [];
let mockAssets: Array<{ id: string; storage_path: string }> = [];
let mockSignedUrls: Array<{ path: string; signedUrl: string }> = [];
let assetLookupShouldError = false;

const mockFrom = vi.fn((table: string) => {
  if (table === "social_post_drafts") {
    const c: Record<string, unknown> = {};
    c["select"] = () => c;
    c["eq"] = () => c;
    c["is"] = () => c;
    c["or"] = () => c;
    c["order"] = () => c;
    c["limit"] = async () => ({
      data: mockDrafts,
      error: null,
    });
    return c;
  }
  if (table === "social_media_assets") {
    const c: Record<string, unknown> = {};
    c["select"] = () => c;
    c["in"] = async () => ({
      data: assetLookupShouldError ? null : mockAssets,
      error: assetLookupShouldError ? { message: "DB error" } : null,
    });
    return c;
  }
  return {};
});

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: mockFrom,
    storage: {
      from: () => ({
        createSignedUrls: async () => ({
          data: mockSignedUrls,
          error: null,
        }),
      }),
    },
  })),
}));

import { GET } from "@/app/api/platform/social/drafts/calendar-view/route";

function makeRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/platform/social/drafts/calendar-view?company_id=${COMPANY_ID}&from=2026-06-01&to=2026-06-30`,
  );
}

function makeDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    state: "scheduled",
    scheduled_at: "2026-06-14T00:00:00Z",
    published_at: null,
    content: "Test caption",
    media_urls: [],
    media_asset_ids: [],
    target_profiles: [],
    parent_draft_id: null,
    link_url: null,
    ...overrides,
  };
}

describe("calendar-view — primary_media_url resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrafts = [];
    mockAssets = [];
    mockSignedUrls = [];
    assetLookupShouldError = false;
    // Re-wire mockFrom after clearAllMocks
    mockFrom.mockImplementation((table: string) => {
      if (table === "social_post_drafts") {
        const c: Record<string, unknown> = {};
        c["select"] = () => c; c["eq"] = () => c; c["is"] = () => c; c["or"] = () => c; c["order"] = () => c;
        c["limit"] = async () => ({ data: mockDrafts, error: null });
        return c;
      }
      if (table === "social_media_assets") {
        const c: Record<string, unknown> = {};
        c["select"] = () => c;
        c["in"] = async () => ({ data: assetLookupShouldError ? null : mockAssets, error: assetLookupShouldError ? { message: "DB error" } : null });
        return c;
      }
      return {};
    });
  });

  it("draft with media_asset_ids and no media_urls → primary_media_url from signed URL", async () => {
    mockDrafts = [makeDraft({ media_asset_ids: [ASSET_ID_1], media_urls: [] })];
    mockAssets = [{ id: ASSET_ID_1, storage_path: STORAGE_PATH }];
    mockSignedUrls = [{ path: STORAGE_PATH, signedUrl: SIGNED_URL }];

    const res = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; data: { posts: Array<{ primary_media_url: string | null }> } };

    expect(res.status).toBe(200);
    expect(body.data.posts[0]!.primary_media_url).toBe(SIGNED_URL);
  });

  it("legacy draft (media_urls only) → primary_media_url from media_urls, no resolution", async () => {
    mockDrafts = [makeDraft({ media_urls: [LEGACY_URL], media_asset_ids: [] })];

    const res = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; data: { posts: Array<{ primary_media_url: string | null }> } };

    expect(body.data.posts[0]!.primary_media_url).toBe(LEGACY_URL);
    // No asset lookup needed for legacy drafts
    expect(mockFrom).not.toHaveBeenCalledWith("social_media_assets");
  });

  it("draft with both media_urls and media_asset_ids → legacy media_urls takes precedence", async () => {
    mockDrafts = [makeDraft({ media_urls: [LEGACY_URL], media_asset_ids: [ASSET_ID_1] })];

    const res = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; data: { posts: Array<{ primary_media_url: string | null }> } };

    expect(body.data.posts[0]!.primary_media_url).toBe(LEGACY_URL);
    expect(mockFrom).not.toHaveBeenCalledWith("social_media_assets");
  });

  it("fail-soft: asset lookup error → primary_media_url null, calendar still loads", async () => {
    mockDrafts = [makeDraft({ media_asset_ids: [ASSET_ID_1], media_urls: [] })];
    assetLookupShouldError = true;

    const res = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; data: { posts: Array<{ primary_media_url: string | null }> } };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.posts[0]!.primary_media_url).toBeNull();
  });

  it("no media at all → primary_media_url null", async () => {
    mockDrafts = [makeDraft({ media_urls: [], media_asset_ids: [] })];

    const res = await GET(makeRequest());
    const body = await res.json() as { ok: boolean; data: { posts: Array<{ primary_media_url: string | null }> } };

    expect(body.data.posts[0]!.primary_media_url).toBeNull();
  });
});
