/**
 * Integration test: recommendation generators → confidence formula pipeline.
 * Runs against a real Supabase instance with seeded data.
 * Focuses on the pipeline mechanics without network calls to the cron endpoint.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { computeConfidence, MIN_POSTS_FOR_RECOMMENDATION } from "@/lib/insights/confidence";
import { generateBestLengthBand } from "@/lib/insights/recommenders/best-length-band";
import { generateBestPostingWindow } from "@/lib/insights/recommenders/best-posting-window";
import { generateQuestionPatternLift } from "@/lib/insights/recommenders/question-pattern-lift";
import { generateMediaTypeLift } from "@/lib/insights/recommenders/media-type-lift";
import { generateHashtagDiminishingReturns } from "@/lib/insights/recommenders/hashtag-diminishing-returns";
import { generateTopicPerformance } from "@/lib/insights/recommenders/topic-performance";
import { getServiceRoleClient } from "@/lib/supabase";

const ALL_GENERATORS = [
  generateBestLengthBand,
  generateBestPostingWindow,
  generateQuestionPatternLift,
  generateMediaTypeLift,
  generateHashtagDiminishingReturns,
  generateTopicPerformance,
];

describe("Recommendation generators — integration", () => {
  let companyId: string;
  let hasEnoughData = false;

  beforeAll(async () => {
    const svc = getServiceRoleClient();
    // Find any company that has ≥ MIN_POSTS_FOR_RECOMMENDATION posts in ins_post_features
    const { data } = await svc.rpc("find_companies_eligible_for_recompute", {
      min_posts: MIN_POSTS_FOR_RECOMMENDATION,
      cutoff_iso: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    });
    if (data && data.length > 0) {
      companyId = data[0].company_id;
      hasEnoughData = true;
    }
  });

  it("confidence formula produces valid bands for all score ranges", () => {
    const floor = computeConfidence({
      postsInWindow: MIN_POSTS_FOR_RECOMMENDATION - 1,
      postsFromLast30d: 0,
      postsFromLast60d: 0,
      coefficientOfVariation: 0,
      effectMagnitude: 1,
    });
    expect(floor.band).toBe("below_floor");
    expect(floor.score).toBe(0);

    const strong = computeConfidence({
      postsInWindow: 100,
      postsFromLast30d: 70,
      postsFromLast60d: 90,
      coefficientOfVariation: 0.1,
      effectMagnitude: 1.0,
    });
    expect(strong.band).toBe("strong");
    expect(strong.score).toBeGreaterThanOrEqual(0.75);

    const moderate = computeConfidence({
      postsInWindow: 50,
      postsFromLast30d: 20,
      postsFromLast60d: 35,
      coefficientOfVariation: 0.35,
      effectMagnitude: 0.6,
    });
    expect(["moderate", "below_floor"]).toContain(moderate.band);
  });

  it("all generators return null or a valid candidate shape against live data", async () => {
    if (!hasEnoughData) {
      console.warn("No company with enough posts found — skipping live generator assertions");
      return;
    }

    for (const generator of ALL_GENERATORS) {
      const result = await generator(companyId, "LINKEDIN", { days: 90 });

      if (result !== null) {
        expect(typeof result.type).toBe("string");
        expect(typeof result.headline).toBe("string");
        expect(typeof result.body).toBe("string");
        expect(result.successMetric).toBe("engagement_rate");
        expect(typeof result.confidenceScore).toBe("number");
        expect(result.confidenceBand).toMatch(/^(strong|moderate|below_floor)$/);
        expect(Array.isArray(result.evidence)).toBe(true);
        for (const ev of result.evidence) {
          expect(["social_post_analytics_snapshots", "ins_post_features"]).toContain(ev.sourceTable);
          expect(typeof ev.sourceRowRef).toBe("string");
          expect(typeof ev.summary).toBe("string");
        }
        // confidence band must not be below_floor (generators filter those out)
        expect(result.confidenceBand).not.toBe("below_floor");
      }
      // null is also valid — not enough data for this company/platform/window combination
    }
  });

  it("generators do not throw on empty platforms", async () => {
    if (!hasEnoughData) return;

    // FACEBOOK may have zero data — generators should return null gracefully
    for (const generator of ALL_GENERATORS) {
      await expect(
        generator(companyId, "FACEBOOK", { days: 90 })
      ).resolves.toSatisfy((r: unknown) => r === null || typeof r === "object");
    }
  });
});
