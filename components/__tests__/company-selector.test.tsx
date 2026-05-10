import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// BSP-1 — CompanySelector: fetch-response check + error banner
//
// Incident class: the original selectCompany() called fetch() and then
// router.refresh() unconditionally, regardless of whether the switch
// endpoint returned a 4xx/5xx. Users would see the UI briefly switch
// then snap back (server state unchanged) with no error message.
//
// Pinned invariant:
//   1. When /api/platform/companies/switch returns !ok (e.g. 403),
//      the error message from the response is rendered in a
//      [data-testid="company-switch-error"] element.
//   2. router.refresh() is NOT called on a non-ok response.
// ---------------------------------------------------------------------------

// next/navigation mock
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

// NavIcon renders nothing meaningful; stub it to keep the test lean.
vi.mock("@/components/ui/nav-icon", () => ({
  NavIcon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@/lib/utils", () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

import { CompanySelector } from "@/components/nav/company-selector";

const COMPANIES = [
  { id: "aaa", name: "Acme", domain: "acme.test", is_opollo_internal: false },
  { id: "bbb", name: "Beta", domain: "beta.test", is_opollo_internal: false },
];

function renderSelector(companyId = "aaa") {
  return render(
    <CompanySelector
      isOpolloStaff={true}
      companyId={companyId}
      companyName="Acme"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default list fetch resolves ok
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/platform/companies/list") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { companies: COMPANIES } }),
      });
    }
    // Default: success for switch
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
  }) as typeof fetch;
});

describe("CompanySelector: error banner on failed switch", () => {
  it("shows error banner and does NOT refresh when switch returns 403", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/platform/companies/list") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { companies: COMPANIES } }),
        });
      }
      // Switch endpoint returns forbidden
      return Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({
            error: { message: "You don't have permission to switch company." },
          }),
      });
    }) as typeof fetch;

    renderSelector();

    // Open the dropdown
    fireEvent.click(screen.getByRole("button", { name: /Company:/i }));

    // Wait for companies to load
    await waitFor(() => expect(screen.getByText("Acme")).toBeDefined());

    // Click company "Beta" to trigger the switch
    const betaBtn = screen.getByText("Beta").closest("button");
    expect(betaBtn).not.toBeNull();
    fireEvent.click(betaBtn!);

    // Error banner must appear
    await waitFor(() => {
      const banner = screen.getByTestId("company-switch-error");
      expect(banner).toBeTruthy();
      expect(banner.textContent).toContain("permission");
    });

    // Router must NOT have refreshed
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("does NOT show error banner on successful switch", async () => {
    renderSelector();

    // Open dropdown
    fireEvent.click(screen.getByRole("button", { name: /Company:/i }));
    await waitFor(() => expect(screen.getByText("Acme")).toBeDefined());

    const betaBtn = screen.getByText("Beta").closest("button");
    expect(betaBtn).not.toBeNull();
    fireEvent.click(betaBtn!);

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("company-switch-error")).toBeNull();
  });

  it("shows fallback message when switch returns !ok with no body", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/platform/companies/list") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { companies: COMPANIES } }),
        });
      }
      return Promise.resolve({
        ok: false,
        // json() rejects — network body missing
        json: () => Promise.reject(new Error("no body")),
      });
    }) as typeof fetch;

    renderSelector();
    fireEvent.click(screen.getByRole("button", { name: /Company:/i }));
    await waitFor(() => expect(screen.getByText("Acme")).toBeDefined());

    const betaBtn = screen.getByText("Beta").closest("button");
    expect(betaBtn).not.toBeNull();
    fireEvent.click(betaBtn!);

    await waitFor(() => {
      const banner = screen.getByTestId("company-switch-error");
      expect(banner.textContent).toContain("Failed to switch");
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Request-body shape — regression for the sentinel-UUID bug.
//
// The Opollo internal company has id "00000000-0000-0000-0000-000000000001".
// Zod v4's .uuid() validator enforces RFC 4122 version/variant bits, which
// rejects that sentinel. The switch endpoint must receive exactly:
//   • { company_id: "<uuid>" }   for tenant companies
//   • { company_id: "<sentinel>" } for the internal/Opollo company
//   • { company_id: null }       when "No company selected" is clicked
// ---------------------------------------------------------------------------

const INTERNAL_ID = "00000000-0000-0000-0000-000000000001";
const COMPANIES_WITH_INTERNAL = [
  { id: "aaa00000-0000-4000-8000-000000000001", name: "Acme", domain: "acme.test", is_opollo_internal: false },
  { id: INTERNAL_ID, name: "Opollo", domain: null, is_opollo_internal: true },
];

describe("CompanySelector: request body shape", () => {
  let capturedBodies: string[] = [];

  beforeEach(() => {
    capturedBodies = [];
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/platform/companies/list") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { companies: COMPANIES_WITH_INTERNAL } }),
        });
      }
      if (typeof init?.body === "string") capturedBodies.push(init.body);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    }) as typeof fetch;
  });

  it("sends { company_id: '<uuid>' } for a tenant company", async () => {
    render(
      <CompanySelector isOpolloStaff={true} companyId={null} companyName={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Company:/i }));
    await waitFor(() => expect(screen.getByText("Acme")).toBeDefined());

    fireEvent.click(screen.getByText("Acme").closest("button")!);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    expect(capturedBodies).toHaveLength(1);
    expect(JSON.parse(capturedBodies[0])).toEqual({ company_id: "aaa00000-0000-4000-8000-000000000001" });
  });

  it("sends { company_id: sentinel } for the internal Opollo company", async () => {
    render(
      <CompanySelector isOpolloStaff={true} companyId={null} companyName={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Company:/i }));
    await waitFor(() => expect(screen.getByText("Opollo")).toBeDefined());

    fireEvent.click(screen.getByText("Opollo").closest("button")!);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    expect(capturedBodies).toHaveLength(1);
    expect(JSON.parse(capturedBodies[0])).toEqual({ company_id: INTERNAL_ID });
  });

  it("sends { company_id: null } when 'No company selected' is clicked", async () => {
    render(
      <CompanySelector isOpolloStaff={true} companyId="aaa00000-0000-4000-8000-000000000001" companyName="Acme" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Company:/i }));
    await waitFor(() => expect(screen.getByText(/No company selected/i)).toBeDefined());

    fireEvent.click(screen.getByText(/No company selected/i).closest("button")!);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));

    expect(capturedBodies).toHaveLength(1);
    expect(JSON.parse(capturedBodies[0])).toEqual({ company_id: null });
  });
});
