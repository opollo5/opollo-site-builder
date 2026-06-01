/**
 * Unit tests for getDraft() media_asset_ids resolution (Gap 3 fix).
 *
 * Tests cover:
 *  - Draft with media_asset_ids → media_urls in response contains signed URLs
 *  - Draft with both media_asset_ids AND legacy media_urls → both appear in response
 *  - Draft with no media_asset_ids → media_urls returned unchanged (zero regression)
 *  - resolveMediaForPublish failure is fail-soft → draft returned without images (no throw)
 *
 * resolve-media.ts is mocked; getDraft itself is the system under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Supabase mock ────────────────────────────────────────────────────────────
const mockDraftRow = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      maybeSingle: () => mockDraftRow(),
    })),
  })),
}));

// ─── resolve-media mock ───────────────────────────────────────────────────────
const mockResolveMedia = vi.fn();
vi.mock("@/lib/social/publishing/resolve-media", () => ({
  resolveMediaForPublish: (...args: unknown[]) => mockResolveMedia(...args),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────
import { getDraft } from "@/lib/platform/social/drafts";

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAFT_ID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_ID = "bbbbbbbb-bbbb-4bbbb-8bbb-bbbbbbbbbbbb";
const ASSET_ID_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ASSET_ID_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SIGNED_URL_1 = "https://project.supabase.co/storage/v1/object/sign/generated-images/path/1.png?token=abc";
const SIGNED_URL_2 = "https://project.supabase.co/storage/v1/object/sign/generated-images/path/2.png?token=def";
const LEGACY_URL  = "https://cdn.example.com/user-uploaded.jpg";

function makeDraftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    company_id: COMPANY_ID,
    state: "scheduled",
    content: "Test caption",
    media_urls: [],
    media_asset_ids: null,
    draft_version: 1,
    draft_data: {},
    scheduled_at: "2026-06-14T00:00:00Z",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getDraft — media_asset_ids resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves media_asset_ids to signed URLs and merges into media_urls", async () => {
    mockDraftRow.mockResolvedValue({
      data: makeDraftRow({ media_asset_ids: [ASSET_ID_1], media_urls: [] }),
      error: null,
    });
    mockResolveMedia.mockResolvedValue([SIGNED_URL_1]);

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { media_urls: string[] }).media_urls).toEqual([SIGNED_URL_1]);

    // resolveMediaForPublish was called with correct args
    expect(mockResolveMedia).toHaveBeenCalledWith({
      mediaAssetIds: [ASSET_ID_1],
      legacyMediaUrls: [],
    });
  });

  it("merges asset-resolved URLs with legacy media_urls (both sources preserved)", async () => {
    mockDraftRow.mockResolvedValue({
      data: makeDraftRow({
        media_asset_ids: [ASSET_ID_1, ASSET_ID_2],
        media_urls: [LEGACY_URL],
      }),
      error: null,
    });
    // resolve-media returns asset URLs first, then legacy (same as the publish pipeline)
    mockResolveMedia.mockResolvedValue([SIGNED_URL_1, SIGNED_URL_2, LEGACY_URL]);

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const urls = (result.data as { media_urls: string[] }).media_urls;
    expect(urls).toContain(SIGNED_URL_1);
    expect(urls).toContain(SIGNED_URL_2);
    expect(urls).toContain(LEGACY_URL);
  });

  it("skips resolution and returns media_urls unchanged when media_asset_ids is empty", async () => {
    mockDraftRow.mockResolvedValue({
      data: makeDraftRow({ media_asset_ids: [], media_urls: [LEGACY_URL] }),
      error: null,
    });

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { media_urls: string[] }).media_urls).toEqual([LEGACY_URL]);
    expect(mockResolveMedia).not.toHaveBeenCalled();
  });

  it("skips resolution and returns media_urls unchanged when media_asset_ids is null", async () => {
    mockDraftRow.mockResolvedValue({
      data: makeDraftRow({ media_asset_ids: null, media_urls: [LEGACY_URL] }),
      error: null,
    });

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.data as { media_urls: string[] }).media_urls).toEqual([LEGACY_URL]);
    expect(mockResolveMedia).not.toHaveBeenCalled();
  });

  it("fail-soft: resolution error returns draft with original media_urls, does not throw", async () => {
    mockDraftRow.mockResolvedValue({
      data: makeDraftRow({ media_asset_ids: [ASSET_ID_1], media_urls: [] }),
      error: null,
    });
    mockResolveMedia.mockRejectedValue(new Error("Supabase storage unavailable"));

    const result = await getDraft({ draftId: DRAFT_ID, companyId: COMPANY_ID });

    // Must not throw — Composer must still open even if images can't be resolved
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Falls back to original media_urls (empty) — no images shown but no crash
    expect((result.data as { media_urls: string[] }).media_urls).toEqual([]);
  });
});
