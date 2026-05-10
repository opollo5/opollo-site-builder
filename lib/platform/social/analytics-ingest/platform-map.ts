import "server-only";

import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// bundle.social's SDK uses different enum strings than our internal
// social_platform enum. This map is the single source of truth for the
// translation. Adding a new platform requires extending both unions.
//
// X (Twitter): bundle.social's analyticsGetSocialAccountAnalytics and
// postImportCreate do NOT include TWITTER — X simply doesn't expose
// the analytics surface via their API. We return null for those calls
// and the analytics UI renders the platform card with a "no analytics
// available" tooltip rather than a broken state.
//
// Google Business: analytics yes, post history import no.

export type BundleSocialAnalyticsPlatform =
  | "TIKTOK"
  | "YOUTUBE"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "THREADS"
  | "REDDIT"
  | "PINTEREST"
  | "MASTODON"
  | "LINKEDIN"
  | "BLUESKY"
  | "GOOGLE_BUSINESS";

export type BundleSocialPostImportPlatform =
  | "FACEBOOK"
  | "INSTAGRAM"
  | "THREADS"
  | "TIKTOK"
  | "YOUTUBE"
  | "LINKEDIN"
  | "PINTEREST"
  | "REDDIT"
  | "MASTODON"
  | "BLUESKY";

const ANALYTICS_PLATFORM_MAP: Partial<
  Record<SocialPlatform, BundleSocialAnalyticsPlatform>
> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  // x: bundle.social analytics surface intentionally does not cover X.
  gbp: "GOOGLE_BUSINESS",
};

const POST_IMPORT_PLATFORM_MAP: Partial<
  Record<SocialPlatform, BundleSocialPostImportPlatform>
> = {
  linkedin_personal: "LINKEDIN",
  linkedin_company: "LINKEDIN",
  facebook_page: "FACEBOOK",
  // x, gbp: bundle.social post-history import surface does not cover them.
};

export function analyticsPlatformFor(
  platform: SocialPlatform,
): BundleSocialAnalyticsPlatform | null {
  return ANALYTICS_PLATFORM_MAP[platform] ?? null;
}

export function postImportPlatformFor(
  platform: SocialPlatform,
): BundleSocialPostImportPlatform | null {
  return POST_IMPORT_PLATFORM_MAP[platform] ?? null;
}

// Inverse lookup — bundle.social platform enum string → internal
// SocialPlatform values. Used when ingesting analytics where bundle.social
// reports the platform on each row and we need to attribute back to one
// of our connection rows.
export function internalPlatformsFor(
  bundlePlatform: BundleSocialAnalyticsPlatform | BundleSocialPostImportPlatform,
): readonly SocialPlatform[] {
  switch (bundlePlatform) {
    case "LINKEDIN":
      return ["linkedin_personal", "linkedin_company"];
    case "FACEBOOK":
      return ["facebook_page"];
    case "GOOGLE_BUSINESS":
      return ["gbp"];
    default:
      return [];
  }
}
