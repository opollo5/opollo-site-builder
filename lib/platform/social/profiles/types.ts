// BSP-3 — types for platform_social_profiles.
//
// Mirrors the kind CHECK constraint and column shape from migration 0118.
// Extending kinds requires a forward-only migration AND extending the
// SocialProfileKind union; TypeScript catches the gap at compile time.

export type SocialProfileKind = "company" | "executive";

export type SocialProfile = {
  id: string;
  company_id: string;
  name: string;
  kind: SocialProfileKind;
  is_default: boolean;
  bundle_social_team_id: string | null;
  created_at: string;
  updated_at: string;
};

export const PROFILE_KIND_LABEL: Record<SocialProfileKind, string> = {
  company: "Company brand",
  executive: "Executive",
};
