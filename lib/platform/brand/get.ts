import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import { BRAND_PROFILE_COLUMNS, type BrandProfile } from "./types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reads the active brand profile for a company. Returns null when the
// company has no brand profile yet (legitimate — the seed fires only for
// the Opollo internal company; customer companies start without one and
// get one created at first-edit time). Per the brand-governance skill,
// callers MUST degrade gracefully when this returns null — never throw.
//
// Service-role read. Caller is responsible for the route-boundary auth
// gate (operator role / company membership).

export async function getActiveBrandProfile(
  companyId: string,
): Promise<BrandProfile | null> {
  if (!UUID_RE.test(companyId)) {
    logger.warn("platform.brand.get.invalid_company_id", { companyId });
    return null;
  }

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("platform_brand_profiles")
    .select(BRAND_PROFILE_COLUMNS)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    logger.error("platform.brand.get.failed", {
      companyId,
      err: error.message,
    });
    return null;
  }
  if (!data) return null;

  return data as unknown as BrandProfile;
}
