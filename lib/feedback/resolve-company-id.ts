// Sentinel UUID for the Opollo-internal company row (migration 0070,
// is_opollo_internal=true). Tickets filed against this company land on the
// staff board without a customer company label.
export const OPOLLO_INTERNAL_COMPANY_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Resolves which companyId to pass to FeedbackWidget, or null if the widget
 * should not mount.
 *
 * Resolution order:
 *  1. Feature flag off or no authenticated session → null
 *  2. User has a company context (company member or staff inside /company/*) → their company
 *  3. Opollo staff on /admin/* → internal sentinel so tickets land on the staff board
 *  4. All other cases (no company, not staff, or non-admin route) → null
 */
export function resolveFeedbackCompanyId({
  featureEnabled,
  companyId,
  isOpolloStaff,
  pathname,
}: {
  featureEnabled: boolean;
  companyId: string | null | undefined;
  isOpolloStaff: boolean;
  pathname: string;
}): string | null {
  if (!featureEnabled) return null;
  if (companyId) return companyId;
  if (isOpolloStaff && pathname.startsWith("/admin")) return OPOLLO_INTERNAL_COMPANY_ID;
  return null;
}
