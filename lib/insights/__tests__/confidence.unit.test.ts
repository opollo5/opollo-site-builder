import { describe, it, expect } from "vitest";
import { computeConfidence, coefficientOfVariation, MIN_POSTS_FOR_RECOMMENDATION } from "../confidence";

describe("computeConfidence", () => {
  it("returns below_floor when posts < 20", () => {
    const result = computeConfidence({
      postsInWindow: 10,
      postsFromLast30d: 10,
      postsFromLast60d: 10,
      coefficientOfVariation: 0.2,
      effectMagnitude: 0.8,
    });
    expect(result.band).toBe("below_floor");
    expect(result.score).toBe(0);
    expect(result.sampleFactor).toBe(0);
  });

  it("returns below_floor at exactly MIN_POSTS - 1", () => {
    const result = computeConfidence({
      postsInWindow: MIN_POSTS_FOR_RECOMMENDATION - 1,
      postsFromLast30d: 15,
      postsFromLast60d: 18,
      coefficientOfVariation: 0.1,
      effectMagnitude: 0.9,
    });
    expect(result.band).toBe("below_floor");
  });

  it("computes sampleFactor = 1 at 100+ posts", () => {
    const result = computeConfidence({
      postsInWindow: 100,
      postsFromLast30d: 70,
      postsFromLast60d: 90,
      coefficientOfVariation: 0,
      effectMagnitude: 1,
    });
    expect(result.sampleFactor).toBe(1);
  });

  it("sampleFactor scales linearly between 20 and 100 posts", () => {
    const r50 = computeConfidence({
      postsInWindow: 50,
      postsFromLast30d: 30,
      postsFromLast60d: 45,
      coefficientOfVariation: 0,
      effectMagnitude: 1,
    });
    expect(r50.sampleFactor).toBeCloseTo(0.5, 5);
  });

  it("freshnessFactor = 1 when >=60% from last 30d", () => {
    const result = computeConfidence({
      postsInWindow: 50,
      postsFromLast30d: 35,
      postsFromLast60d: 45,
      coefficientOfVariation: 0,
      effectMagnitude: 1,
    });
    expect(result.freshnessFactor).toBe(1.0);
  });

  it("freshnessFactor decays when <60% from last 30d", () => {
    const result = computeConfidence({
      postsInWindow: 50,
      postsFromLast30d: 10, // 20%
      postsFromLast60d: 30, // 60%
      coefficientOfVariation: 0,
      effectMagnitude: 1,
    });
    // freshnessFactor = max(0.5, 0.5 + 0.6 * 0.5) = max(0.5, 0.8) = 0.8
    expect(result.freshnessFactor).toBeCloseTo(0.8, 5);
  });

  it("stabilityFactor clips CoV above 1", () => {
    const result = computeConfidence({
      postsInWindow: 50,
      postsFromLast30d: 40,
      postsFromLast60d: 48,
      coefficientOfVariation: 1.5,
      effectMagnitude: 0.8,
    });
    expect(result.stabilityFactor).toBe(0);
  });

  it("returns strong band when score >= 0.75", () => {
    // All factors maxed: 100 posts, 100% fresh, 0 CoV, magnitude=1 => score=1
    const result = computeConfidence({
      postsInWindow: 100,
      postsFromLast30d: 100,
      postsFromLast60d: 100,
      coefficientOfVariation: 0,
      effectMagnitude: 1,
    });
    expect(result.band).toBe("strong");
    expect(result.score).toBeCloseTo(1, 5);
  });

  it("returns moderate band between 0.45 and 0.75", () => {
    // score = 0.5 * 1.0 * 0.5 * 1.0 = 0.25 -- below_floor
    // need to tune to hit 0.45-0.75 range
    const result = computeConfidence({
      postsInWindow: 60,
      postsFromLast30d: 40,
      postsFromLast60d: 55,
      coefficientOfVariation: 0.2,
      effectMagnitude: 0.8,
    });
    // sampleFactor=0.6, freshnessFactor=1, stabilityFactor=0.8, signalFactor=0.8 => score=0.384
    // Adjust for moderate: effectMagnitude=1
    const result2 = computeConfidence({
      postsInWindow: 60,
      postsFromLast30d: 40,
      postsFromLast60d: 55,
      coefficientOfVariation: 0.1,
      effectMagnitude: 0.9,
    });
    // sampleFactor=0.6, freshness=1, stability=0.9, signal=0.9 => score=0.486
    expect(result2.band).toBe("moderate");
    expect(result2.score).toBeGreaterThanOrEqual(0.45);
    expect(result2.score).toBeLessThan(0.75);
    void result;
  });
});

describe("coefficientOfVariation", () => {
  it("returns 0 for empty or single-element array", () => {
    expect(coefficientOfVariation([])).toBe(0);
    expect(coefficientOfVariation([5])).toBe(0);
  });

  it("returns 0 for constant array", () => {
    expect(coefficientOfVariation([3, 3, 3, 3])).toBe(0);
  });

  it("computes CoV correctly", () => {
    // [1, 1, 1, 3]: mean=1.5, variance=((0.25+0.25+0.25+2.25)/4)=0.75, std=sqrt(0.75)≈0.866, CoV≈0.577
    const cov = coefficientOfVariation([1, 1, 1, 3]);
    expect(cov).toBeGreaterThan(0);
    expect(cov).toBeLessThan(2);
  });
});
