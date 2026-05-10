import { describe, expect, it } from "vitest";

import {
  analyticsPlatformFor,
  internalPlatformsFor,
  postImportPlatformFor,
} from "@/lib/platform/social/analytics-ingest";

// LAYER 1 — Unit. Pure functions, no SDK, no DB.
//
// Locks the SocialPlatform ↔ bundle.social enum mapping so a careless
// extension of the SocialPlatform union doesn't silently drop a platform
// from analytics ingestion (the symptom would be "no analytics ever
// show up for this platform" and would take a release cycle to notice).

describe("BSP analytics — platform map", () => {
  describe("analyticsPlatformFor", () => {
    it("maps both LinkedIn variants to LINKEDIN", () => {
      expect(analyticsPlatformFor("linkedin_personal")).toBe("LINKEDIN");
      expect(analyticsPlatformFor("linkedin_company")).toBe("LINKEDIN");
    });

    it("maps facebook_page to FACEBOOK", () => {
      expect(analyticsPlatformFor("facebook_page")).toBe("FACEBOOK");
    });

    it("maps gbp to GOOGLE_BUSINESS", () => {
      expect(analyticsPlatformFor("gbp")).toBe("GOOGLE_BUSINESS");
    });

    it("returns null for x (no analytics API support)", () => {
      expect(analyticsPlatformFor("x")).toBe(null);
    });
  });

  describe("postImportPlatformFor", () => {
    it("maps both LinkedIn variants to LINKEDIN", () => {
      expect(postImportPlatformFor("linkedin_personal")).toBe("LINKEDIN");
      expect(postImportPlatformFor("linkedin_company")).toBe("LINKEDIN");
    });

    it("maps facebook_page to FACEBOOK", () => {
      expect(postImportPlatformFor("facebook_page")).toBe("FACEBOOK");
    });

    it("returns null for x (post import unsupported)", () => {
      expect(postImportPlatformFor("x")).toBe(null);
    });

    it("returns null for gbp (post import unsupported)", () => {
      expect(postImportPlatformFor("gbp")).toBe(null);
    });
  });

  describe("internalPlatformsFor (inverse lookup)", () => {
    it("returns both LinkedIn variants for LINKEDIN", () => {
      const result = internalPlatformsFor("LINKEDIN");
      expect(result).toContain("linkedin_personal");
      expect(result).toContain("linkedin_company");
    });

    it("returns facebook_page for FACEBOOK", () => {
      expect(internalPlatformsFor("FACEBOOK")).toEqual(["facebook_page"]);
    });

    it("returns gbp for GOOGLE_BUSINESS", () => {
      expect(internalPlatformsFor("GOOGLE_BUSINESS")).toEqual(["gbp"]);
    });

    it("returns empty array for platforms outside the mapped set", () => {
      expect(internalPlatformsFor("TIKTOK")).toEqual([]);
      expect(internalPlatformsFor("YOUTUBE")).toEqual([]);
    });
  });
});
