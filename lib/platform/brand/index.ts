// Public surface for lib/platform/brand. Outside callers MUST import
// from "@/lib/platform/brand" — never from a sub-path. (Same module-
// boundary rule the optimiser + invitations + companies modules follow.)

export { getActiveBrandProfile } from "./get";
export {
  updateBrandProfile,
  type BrandProfilePatch,
  type BrandUpdateError,
  type BrandUpdateResult,
} from "./update";
export {
  brandTierDescription,
  brandTierLabel,
  getBrandTier,
  type BrandTier,
} from "./completion";
export {
  BRAND_PROFILE_COLUMNS,
  type BrandFormality,
  type BrandHashtag,
  type BrandImageStyle,
  type BrandPlatformOverrides,
  type BrandPostLength,
  type BrandPov,
  type BrandProfile,
  type OpolloProduct,
  type SocialApprovalRule,
} from "./types";
