import { describe, expect, it } from "vitest";

import {
  getMetaDescriptionFeedback,
  getSeoTitleFeedback,
} from "@/lib/seo/length-feedback";

describe("getSeoTitleFeedback", () => {
  it("flags 0 chars as too short / red", () => {
    const f = getSeoTitleFeedback(0);
    expect(f.color).toBe("red");
    expect(f.label).toBe("too short");
    expect(f.percentage).toBe(0);
  });

  it("flags 19 chars as too short / red (boundary)", () => {
    const f = getSeoTitleFeedback(19);
    expect(f.color).toBe("red");
    expect(f.label).toBe("too short");
  });

  it("flags 20 chars as getting there / orange", () => {
    const f = getSeoTitleFeedback(20);
    expect(f.color).toBe("orange");
    expect(f.label).toBe("getting there");
  });

  it("flags 30 chars as getting there / orange (per brief example)", () => {
    const f = getSeoTitleFeedback(30);
    expect(f.color).toBe("orange");
    expect(f.label).toBe("getting there");
  });

  it("flags 50 chars as typically good / green (lower good boundary)", () => {
    const f = getSeoTitleFeedback(50);
    expect(f.color).toBe("green");
    expect(f.label).toBe("typically good");
  });

  it("flags 55 chars as typically good / green (per brief example)", () => {
    const f = getSeoTitleFeedback(55);
    expect(f.color).toBe("green");
    expect(f.label).toBe("typically good");
  });

  it("flags 60 chars as typically good / green (upper good boundary)", () => {
    const f = getSeoTitleFeedback(60);
    expect(f.color).toBe("green");
    expect(f.label).toBe("typically good");
    expect(f.percentage).toBe(100);
  });

  it("flags 61 chars as may truncate / orange", () => {
    const f = getSeoTitleFeedback(61);
    expect(f.color).toBe("orange");
    expect(f.label).toBe("may truncate");
  });

  it("flags 70 chars as may truncate / orange (boundary)", () => {
    const f = getSeoTitleFeedback(70);
    expect(f.color).toBe("orange");
    expect(f.label).toBe("may truncate");
  });

  it("flags 71 chars as likely truncates / red", () => {
    const f = getSeoTitleFeedback(71);
    expect(f.color).toBe("red");
    expect(f.label).toBe("likely truncates");
  });

  it("flags 75 chars as likely truncates / red (per brief example)", () => {
    const f = getSeoTitleFeedback(75);
    expect(f.color).toBe("red");
    expect(f.label).toBe("likely truncates");
  });

  it("never uses definitive wording — no 'ideal' or 'perfect'", () => {
    for (let len = 0; len <= 200; len++) {
      const label = getSeoTitleFeedback(len).label;
      expect(label).not.toMatch(/\b(ideal|perfect|exact|guaranteed)\b/i);
    }
  });

  it("caps percentage at 100", () => {
    expect(getSeoTitleFeedback(200).percentage).toBe(100);
  });
});

describe("getMetaDescriptionFeedback", () => {
  it("flags 0 chars as too short / red", () => {
    expect(getMetaDescriptionFeedback(0).color).toBe("red");
    expect(getMetaDescriptionFeedback(0).label).toBe("too short");
  });

  it("flags 49 chars as too short (lower bound boundary)", () => {
    expect(getMetaDescriptionFeedback(49).color).toBe("red");
    expect(getMetaDescriptionFeedback(49).label).toBe("too short");
  });

  it("flags 50 chars as getting there", () => {
    expect(getMetaDescriptionFeedback(50).color).toBe("orange");
    expect(getMetaDescriptionFeedback(50).label).toBe("getting there");
  });

  it("flags 119 chars as getting there (upper boundary)", () => {
    expect(getMetaDescriptionFeedback(119).color).toBe("orange");
    expect(getMetaDescriptionFeedback(119).label).toBe("getting there");
  });

  it("flags 120 chars as typically good (lower good)", () => {
    expect(getMetaDescriptionFeedback(120).color).toBe("green");
    expect(getMetaDescriptionFeedback(120).label).toBe("typically good");
  });

  it("flags 156 chars as typically good (upper good)", () => {
    expect(getMetaDescriptionFeedback(156).color).toBe("green");
    expect(getMetaDescriptionFeedback(156).label).toBe("typically good");
    expect(getMetaDescriptionFeedback(156).percentage).toBe(100);
  });

  it("flags 157 chars as may truncate", () => {
    expect(getMetaDescriptionFeedback(157).color).toBe("orange");
    expect(getMetaDescriptionFeedback(157).label).toBe("may truncate");
  });

  it("flags 170 chars as may truncate (upper)", () => {
    expect(getMetaDescriptionFeedback(170).color).toBe("orange");
    expect(getMetaDescriptionFeedback(170).label).toBe("may truncate");
  });

  it("flags 171 chars as likely truncates", () => {
    expect(getMetaDescriptionFeedback(171).color).toBe("red");
    expect(getMetaDescriptionFeedback(171).label).toBe("likely truncates");
  });

  it("never uses definitive wording", () => {
    for (let len = 0; len <= 300; len++) {
      const label = getMetaDescriptionFeedback(len).label;
      expect(label).not.toMatch(/\b(ideal|perfect|exact|guaranteed)\b/i);
    }
  });
});
