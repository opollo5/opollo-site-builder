import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only and supabase before importing
vi.mock("server-only", () => ({}));

const mockFrom = vi.fn();
const mockSupabase = { from: mockFrom };
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => mockSupabase,
}));

import { aggregateEditPatterns } from "../memory-aggregator";

describe("aggregateEditPatterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when fewer than 5 edited posts", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: [{ id: "1", rejection_reason: "too long", regenerate_count: 1 }] }),
    };
    mockFrom.mockReturnValue(chain);

    const result = await aggregateEditPatterns("co-1");
    expect(result).toBe(0);
  });

  it("returns 0 when no edited posts returned", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      gt: vi.fn().mockResolvedValue({ data: [] }),
    };
    mockFrom.mockReturnValue(chain);

    const result = await aggregateEditPatterns("co-1");
    expect(result).toBe(0);
  });

  it("writes patterns with >= 3 occurrences and skips those with < 3", async () => {
    const editedPosts = [
      { id: "1", rejection_reason: "too long", regenerate_count: 1 },
      { id: "2", rejection_reason: "too long", regenerate_count: 2 },
      { id: "3", rejection_reason: "too long", regenerate_count: 1 },
      { id: "4", rejection_reason: "off brand", regenerate_count: 1 },
      { id: "5", rejection_reason: "off brand", regenerate_count: 1 },
      // "too long" appears 3x → should be written. "off brand" appears 2x → skipped.
    ];

    const upsertMock = vi.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_campaign_posts") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          gt: vi.fn().mockResolvedValue({ data: editedPosts }),
        };
      }
      return { upsert: upsertMock };
    });

    const result = await aggregateEditPatterns("co-1");

    // Only "too long" (3 occurrences) should trigger upsert
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memory_type: "edit_pattern",
        payload: expect.objectContaining({ pattern: "too long" }),
      }),
      expect.anything(),
    );
    expect(result).toBe(1);
  });
});
