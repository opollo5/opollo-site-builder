/**
 * L6 Security — CompetitorVisibility must not render when consent is OFF.
 *
 * A client without competitor_tracking_consent=TRUE must not see the
 * competitor tracking section on their insights dashboard.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.resetModules();
});

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeSvc(opts: { consent: boolean; companyId: string }) {
  return {
    from: (table: string) => {
      if (table === "ins_consent") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { competitor_tracking_consent: opts.consent },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "ins_competitor_accounts") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                order: () =>
                  Promise.resolve({
                    data: [
                      {
                        platform: "LINKEDIN",
                        competitor_handle: "acme-corp",
                        competitor_display_name: "Acme Corp",
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      return { select: () => ({ eq: () => ({ is: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) };
    },
  };
}

describe("SECURITY: CompetitorVisibility consent gate", () => {
  it("returns null when competitor_tracking_consent is FALSE", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => makeSvc({ consent: false, companyId: COMPANY_A }),
    }));

    const { CompetitorVisibility } = await import(
      "@/components/insights/CompetitorVisibility"
    );

    const result = await CompetitorVisibility({ companyId: COMPANY_A });
    expect(result).toBeNull();
  });

  it("renders section when competitor_tracking_consent is TRUE", async () => {
    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => makeSvc({ consent: true, companyId: COMPANY_B }),
    }));

    const { CompetitorVisibility } = await import(
      "@/components/insights/CompetitorVisibility"
    );

    const result = await CompetitorVisibility({ companyId: COMPANY_B });
    expect(result).not.toBeNull();
  });

  it("does NOT expose company B competitors to company A (cross-tenant isolation)", async () => {
    const queriedCompanyIds: string[] = [];
    const svc = {
      from: (table: string) => {
        if (table === "ins_consent") {
          return {
            select: () => ({
              eq: (_: string, id: string) => {
                queriedCompanyIds.push(id);
                return {
                  maybeSingle: () =>
                    Promise.resolve({
                      data: { competitor_tracking_consent: true },
                      error: null,
                    }),
                };
              },
            }),
          };
        }
        return {
          select: () => ({
            eq: (_: string, id: string) => {
              queriedCompanyIds.push(id);
              return {
                is: () => ({
                  order: () => Promise.resolve({ data: [], error: null }),
                }),
              };
            },
          }),
        };
      },
    };

    vi.doMock("@/lib/supabase", () => ({
      getServiceRoleClient: () => svc,
    }));

    const { CompetitorVisibility } = await import(
      "@/components/insights/CompetitorVisibility"
    );

    await CompetitorVisibility({ companyId: COMPANY_A });

    // All queries must be scoped to COMPANY_A only — no COMPANY_B IDs
    expect(queriedCompanyIds.every((id) => id === COMPANY_A)).toBe(true);
    expect(queriedCompanyIds).not.toContain(COMPANY_B);
  });
});
