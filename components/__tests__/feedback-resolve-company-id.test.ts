import { describe, it, expect } from "vitest";
import {
  resolveFeedbackCompanyId,
  OPOLLO_INTERNAL_COMPANY_ID,
} from "@/lib/feedback/resolve-company-id";

const CUSTOMER_COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001";

describe("resolveFeedbackCompanyId", () => {
  // ── Feature flag off ──────────────────────────────────────────────────────

  it("returns null when feature flag is off regardless of session", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: false,
        companyId: CUSTOMER_COMPANY_ID,
        isOpolloStaff: false,
        pathname: "/company/something",
      }),
    ).toBeNull();
  });

  it("returns null when feature flag is off even for staff on /admin", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: false,
        companyId: null,
        isOpolloStaff: true,
        pathname: "/admin/feedback",
      }),
    ).toBeNull();
  });

  // ── Company members ───────────────────────────────────────────────────────

  it("returns companyId for a company member on any route", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: CUSTOMER_COMPANY_ID,
        isOpolloStaff: false,
        pathname: "/company/something/social",
      }),
    ).toBe(CUSTOMER_COMPANY_ID);
  });

  // ── Opollo staff on /admin/* ──────────────────────────────────────────────

  it("returns internal sentinel for staff on /admin/feedback", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: null,
        isOpolloStaff: true,
        pathname: "/admin/feedback",
      }),
    ).toBe(OPOLLO_INTERNAL_COMPANY_ID);
  });

  it("returns internal sentinel for staff on any /admin/* sub-route", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: null,
        isOpolloStaff: true,
        pathname: "/admin/companies/some-id/social-profiles",
      }),
    ).toBe(OPOLLO_INTERNAL_COMPANY_ID);
  });

  it("prefers explicit companyId over sentinel even for staff", () => {
    // Staff visiting /company/* have a company context — use it, not the sentinel.
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: CUSTOMER_COMPANY_ID,
        isOpolloStaff: true,
        pathname: "/company/something",
      }),
    ).toBe(CUSTOMER_COMPANY_ID);
  });

  // ── Staff on non-admin routes with no company context ────────────────────

  it("returns null for staff on /account with no company context", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: null,
        isOpolloStaff: true,
        pathname: "/account/settings",
      }),
    ).toBeNull();
  });

  it("returns null for staff on /optimiser with no company context", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: null,
        isOpolloStaff: true,
        pathname: "/optimiser",
      }),
    ).toBeNull();
  });

  // ── Non-staff with no company on admin route (shouldn't happen but guard) ─

  it("returns null for non-staff user with no company on /admin route", () => {
    expect(
      resolveFeedbackCompanyId({
        featureEnabled: true,
        companyId: null,
        isOpolloStaff: false,
        pathname: "/admin/feedback",
      }),
    ).toBeNull();
  });
});
