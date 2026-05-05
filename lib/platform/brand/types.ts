// Platform brand profile shape — mirrors public.platform_brand_profiles
// in supabase/migrations/0074_platform_audit_and_brand.sql.
//
// Brand profile is versioned: NEVER UPDATE the row directly. Always call
// the update_brand_profile() RPC, which deactivates the current row and
// inserts a new one with version+1. See platform-brand-governance skill.

export type BrandFormality = "formal" | "semi_formal" | "casual";
export type BrandPov = "first_person" | "third_person";
export type BrandHashtag = "none" | "minimal" | "standard" | "heavy";
export type BrandPostLength = "short" | "medium" | "long";
export type SocialApprovalRule = "any_one" | "all_must";
export type OpolloProduct =
  | "site_builder"
  | "social"
  | "cap"
  | "blog"
  | "email";

// JSONB fields are open-shape — operators write whatever the editor
// surfaces. We type them as Record<string, unknown> rather than `any` so
// downstream consumers either narrow at the read site or accept the
// operator-supplied shape verbatim.
export type BrandImageStyle = Record<string, unknown>;
export type BrandPlatformOverrides = Record<string, unknown>;

export type BrandProfile = {
  id: string;
  company_id: string;
  version: number;
  is_active: boolean;
  change_summary: string | null;

  // Visual identity
  primary_colour: string | null;
  secondary_colour: string | null;
  accent_colour: string | null;
  logo_primary_url: string | null;
  logo_dark_url: string | null;
  logo_light_url: string | null;
  logo_icon_url: string | null;
  heading_font: string | null;
  body_font: string | null;
  image_style: BrandImageStyle;
  approved_style_ids: string[];
  safe_mode: boolean;

  // Tone of voice
  personality_traits: string[];
  formality: BrandFormality | null;
  point_of_view: BrandPov | null;
  preferred_vocabulary: string[];
  avoided_terms: string[];
  voice_examples: string[];

  // Content guardrails
  focus_topics: string[];
  avoided_topics: string[];
  industry: string | null;

  // Operational defaults
  default_approval_required: boolean;
  default_approval_rule: SocialApprovalRule | null;
  platform_overrides: BrandPlatformOverrides;
  hashtag_strategy: BrandHashtag | null;
  max_post_length: BrandPostLength | null;
  content_restrictions: string[];

  // Audit
  updated_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// Selected columns for the active-profile read. Mirrors the SELECT in
// lib/platform/brand/get.ts so the row → BrandProfile mapping is a
// straight cast.
export const BRAND_PROFILE_COLUMNS = [
  "id",
  "company_id",
  "version",
  "is_active",
  "change_summary",
  "primary_colour",
  "secondary_colour",
  "accent_colour",
  "logo_primary_url",
  "logo_dark_url",
  "logo_light_url",
  "logo_icon_url",
  "heading_font",
  "body_font",
  "image_style",
  "approved_style_ids",
  "safe_mode",
  "personality_traits",
  "formality",
  "point_of_view",
  "preferred_vocabulary",
  "avoided_terms",
  "voice_examples",
  "focus_topics",
  "avoided_topics",
  "industry",
  "default_approval_required",
  "default_approval_rule",
  "platform_overrides",
  "hashtag_strategy",
  "max_post_length",
  "content_restrictions",
  "updated_by",
  "created_by",
  "created_at",
  "updated_at",
].join(", ");
