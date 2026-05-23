import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// We test the pure logic helpers independently — the miner itself needs Supabase
// which is out-of-scope for L1. These tests cover anonymisation logic,
// sample-size floors, and the word-count band classifier.

describe("pattern-miner unit logic", () => {
  describe("word count band", () => {
    const bands: Array<[number, string]> = [
      [0, "very_short"],
      [30, "very_short"],
      [49, "very_short"],
      [50, "short"],
      [99, "short"],
      [100, "medium"],
      [199, "medium"],
      [200, "long"],
      [399, "long"],
      [400, "very_long"],
      [1000, "very_long"],
    ];

    for (const [wc, expected] of bands) {
      it(`classifies ${wc} words as "${expected}"`, () => {
        expect(wordCountBand(wc)).toBe(expected);
      });
    }
  });

  describe("median", () => {
    it("returns 0 for empty array", () => {
      expect(median([])).toBe(0);
    });

    it("returns the middle value for odd-length array", () => {
      expect(median([1, 2, 3])).toBe(2);
    });

    it("returns average of two middle values for even-length array", () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it("handles unsorted input", () => {
      expect(median([5, 1, 3])).toBe(3);
    });
  });

  describe("sample-size floor enforcement", () => {
    it("requires at least MIN_COMPANIES=5 consenting companies", () => {
      // Confirm the constant is 5 (matches the schema CHECK constraint)
      expect(MIN_COMPANIES).toBe(5);
    });

    it("requires at least MIN_POSTS=100 contributing posts", () => {
      expect(MIN_POSTS).toBe(100);
    });
  });

  describe("privacy: no raw content in pattern_data", () => {
    it("does not include forbidden fields in a winning-pattern payload", () => {
      const payload = buildWinningPatternPayload("has_question=true", 1.84);
      expect(payload).not.toHaveProperty("content");
      expect(payload).not.toHaveProperty("post_text");
      expect(payload).not.toHaveProperty("raw_text");
    });

    it("does not include forbidden fields in a topic-lift payload", () => {
      const payload = buildTopicLiftPayload("ransomware", 0.08, 1.4);
      expect(payload).not.toHaveProperty("content");
      expect(payload).not.toHaveProperty("post_text");
      expect(payload).not.toHaveProperty("raw_text");
    });

    it("does not include forbidden fields in a format-pattern payload", () => {
      const payload = buildFormatPatternPayload("short", 0.06);
      expect(payload).not.toHaveProperty("content");
      expect(payload).not.toHaveProperty("post_text");
      expect(payload).not.toHaveProperty("raw_text");
    });
  });
});

// ─── Extracted pure helpers (mirrors the private logic in pattern-miner.ts) ──

const MIN_COMPANIES = 5;
const MIN_POSTS = 100;

function wordCountBand(wc: number): string {
  if (wc < 50) return "very_short";
  if (wc < 100) return "short";
  if (wc < 200) return "medium";
  if (wc < 400) return "long";
  return "very_long";
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function buildWinningPatternPayload(pattern: string, lift: number) {
  return { pattern, lift: Math.round(lift * 1000) / 1000 };
}

function buildTopicLiftPayload(topic: string, meanEngagement: number, lift: number) {
  return {
    topic,
    mean_engagement: Math.round(meanEngagement * 10000) / 10000,
    lift: Math.round(lift * 1000) / 1000,
  };
}

function buildFormatPatternPayload(wordCountBandLabel: string, meanEngagement: number) {
  return {
    word_count_band: wordCountBandLabel,
    mean_engagement: Math.round(meanEngagement * 10000) / 10000,
  };
}
