import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// Platform-semantic colour + initial pairs for the analytics dashboard.
// Tailwind tokens via inline hex to keep Recharts (which expects hex /
// rgb / hsl) happy — utility class names don't work inside chart props.

export const PLATFORM_COLOR: Record<SocialPlatform, string> = {
  linkedin_personal: "#0a66c2",
  linkedin_company: "#0a66c2",
  facebook_page: "#1877f2",
  instagram_business: "#e1306c",
  x: "#111827",
  gbp: "#34a853",
};

// Two-letter abbreviation for the platform tile in stat cards. Same
// shape as the platform-icon avatars used elsewhere; keeps the
// dashboard light on third-party icon-pack dependencies.
export const PLATFORM_INITIALS: Record<SocialPlatform, string> = {
  linkedin_personal: "Li",
  linkedin_company: "Li",
  facebook_page: "Fb",
  instagram_business: "Ig",
  x: "X",
  gbp: "GB",
};

// Platforms whose analytics surface bundle.social does not expose. The
// dashboard renders a greyed card with a tooltip rather than zeros.
export const PLATFORMS_WITHOUT_ANALYTICS: ReadonlySet<SocialPlatform> = new Set([
  "x",
]);

export function platformHasAnalytics(p: SocialPlatform): boolean {
  return !PLATFORMS_WITHOUT_ANALYTICS.has(p);
}
