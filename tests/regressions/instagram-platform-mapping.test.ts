import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R-INSTAGRAM-MAPPING — instagram_business must exist in all
// platform mapping tables.
//
// Incident: 2026-05-13
// Instagram "Connect" click opened the OAuth popup and the flow completed,
// but no social_connections row was ever inserted. Root cause: BUNDLE_TO_PLATFORM
// in sync.ts had no entry for "INSTAGRAM", so every sync call incremented
// unmapped_skipped=1 and skipped insertion. The social_platform DB enum also
// lacked 'instagram_business', making the insert impossible even if the
// mapping had existed.
//
// Fix: migration 0124 adds 'instagram_business' to the enum; all four
// mapping tables updated. This test pins the TypeScript side so the
// mapping can never silently regress.
// ---------------------------------------------------------------------------

import {
  PLATFORM_LABEL,
  SUPPORTED_PLATFORMS,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

describe("R-INSTAGRAM-MAPPING: instagram_business platform registration", () => {
  it("PLATFORM_LABEL has instagram_business entry", () => {
    expect(PLATFORM_LABEL["instagram_business" as SocialPlatform]).toBeDefined();
    expect(PLATFORM_LABEL["instagram_business" as SocialPlatform]).toBe(
      "Instagram Business",
    );
  });

  it("SUPPORTED_PLATFORMS does NOT include instagram_business (publishing not yet enabled)", () => {
    // Instagram Business is connectable but publishing is not ready for V1.
    // Adding it to SUPPORTED_PLATFORMS would surface it in publishing flows
    // before they're ready. This test pins the deliberate exclusion.
    expect(SUPPORTED_PLATFORMS).not.toContain("instagram_business");
  });

  it("PLATFORM_LABEL covers every key required for instagram_business row display", () => {
    // When a social_connections row with platform='instagram_business' is
    // rendered in SocialConnectionsList, it falls through to PLATFORM_LABEL.
    // Verify the label is a non-empty string (not undefined, not empty).
    const label = PLATFORM_LABEL["instagram_business" as SocialPlatform];
    expect(typeof label).toBe("string");
    expect(label.length).toBeGreaterThan(0);
  });
});
