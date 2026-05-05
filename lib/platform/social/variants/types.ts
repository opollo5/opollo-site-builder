import type { SocialPostState } from "@/lib/platform/social/posts";

// Mirrors social_platform enum in migration 0070. Keep aligned: extending
// the enum requires a forward-only migration AND extending this literal
// union.
export type SocialPlatform =
  | "linkedin_personal"
  | "linkedin_company"
  | "facebook_page"
  | "x"
  | "gbp";

// Display order for the V1 detail page. Ordering also drives the
// recipient list rendering in approval flows (later slice).
export const SUPPORTED_PLATFORMS: readonly SocialPlatform[] = [
  "linkedin_personal",
  "linkedin_company",
  "facebook_page",
  "x",
  "gbp",
] as const;

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  linkedin_personal: "LinkedIn (personal)",
  linkedin_company: "LinkedIn (company)",
  facebook_page: "Facebook Page",
  x: "X",
  gbp: "Google Business Profile",
};

export type PostVariant = {
  id: string;
  post_master_id: string;
  platform: SocialPlatform;
  connection_id: string | null;
  // Null means "no override" — the brief / publish layer falls back to
  // master_text when sending. is_custom + variant_text move together.
  variant_text: string | null;
  is_custom: boolean;
  scheduled_at: string | null;
  media_asset_ids: string[];
  created_at: string;
  updated_at: string;
};

export type UpsertVariantInput = {
  postMasterId: string;
  // Caller MUST verify company scoping before calling — the lib reads
  // the parent post by (post_id, company_id) and returns NOT_FOUND if
  // the post isn't in this company.
  companyId: string;
  platform: SocialPlatform;
  // Empty / whitespace-only collapses to null (resets to "use master").
  // is_custom is derived: non-null variant_text → true; null → false.
  variantText: string | null;
  // S1-24: optional media attachments. When present (including empty
  // []), the column is overwritten — pass undefined to leave the
  // existing array untouched on upsert. Each id must reference a
  // social_media_assets row in the same company; the lib enforces
  // this guard.
  mediaAssetIds?: string[];
};

export type ListVariantsInput = {
  postMasterId: string;
  companyId: string;
};

// Read shape returned to the detail page so the UI can show the
// effective text per platform without a second round trip. `effective`
// = variant_text when is_custom, else parent.master_text.
export type ResolvedVariant = {
  platform: SocialPlatform;
  variant: PostVariant | null;
  effective_text: string | null;
};

export type ListVariantsResult = {
  postState: SocialPostState;
  masterText: string | null;
  resolved: ResolvedVariant[];
};
