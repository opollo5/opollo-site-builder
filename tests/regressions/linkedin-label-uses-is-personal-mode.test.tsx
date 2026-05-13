// @vitest-environment jsdom

// ---------------------------------------------------------------------------
// REGRESSION — LinkedIn connection label must be driven by is_personal_mode,
// not the platform enum value.
//
// Before fix: platform="linkedin_personal" always showed "LinkedIn (personal)"
// even when an org page was bound (is_personal_mode=false, external_account_id
// = urn:li:organization:...).
//
// After fix:
//   is_personal_mode=false → "LinkedIn"
//   is_personal_mode=true  → "LinkedIn (personal)"
// ---------------------------------------------------------------------------

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/toast-success", () => ({ toastSuccess: vi.fn() }));

import { SocialConnectionsList } from "@/components/SocialConnectionsList";
import type { SocialConnection } from "@/lib/platform/social/connections/types";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

const BASE_PROPS = {
  companyId: "company-1",
  profileId: "profile-1",
  connections: [] as SocialConnection[],
  canManage: true,
  canReconnect: true,
};

function makeLinkedInConn(
  overrides: Partial<SocialConnection> = {},
): SocialConnection {
  return {
    id: "conn-1",
    company_id: "company-1",
    profile_id: "profile-1",
    platform: "linkedin_personal",
    bundle_social_account_id: "bs-1",
    display_name: "Opollo MSP Marketing",
    avatar_url: null,
    status: "healthy",
    last_error: null,
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    last_health_check_at: new Date().toISOString(),
    external_account_id: "urn:li:organization:105341307",
    external_user_id: "urn:li:person:abc",
    external_identity_hash: null,
    is_personal_mode: false,
    has_emitted_overdue_event: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  vi.clearAllMocks();
});

describe("R-LINKEDIN-LABEL: label driven by is_personal_mode, not platform enum", () => {
  it("is_personal_mode=false → renders 'LinkedIn' (org page bound)", () => {
    const conn = makeLinkedInConn({ is_personal_mode: false });
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    // Find the cell that shows the platform label for this connection row.
    const row = screen.getByTestId(`connection-row-${conn.id}`);
    expect(row).toHaveTextContent("LinkedIn");
    expect(row).not.toHaveTextContent("LinkedIn (personal)");
  });

  it("is_personal_mode=true → renders 'LinkedIn (personal)' (personal profile bound)", () => {
    const conn = makeLinkedInConn({
      is_personal_mode: true,
      external_account_id: "urn:li:person:abc",
      display_name: "Steven Morey",
    });
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    const row = screen.getByTestId(`connection-row-${conn.id}`);
    expect(row).toHaveTextContent("LinkedIn (personal)");
  });

  it("platform=linkedin_company, is_personal_mode=false → renders 'LinkedIn'", () => {
    const conn = makeLinkedInConn({
      platform: "linkedin_company",
      is_personal_mode: false,
    } as Partial<SocialConnection>);
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    const row = screen.getByTestId(`connection-row-${conn.id}`);
    expect(row).toHaveTextContent("LinkedIn");
    expect(row).not.toHaveTextContent("(personal)");
  });

  it("non-LinkedIn platform (x) label is unaffected", () => {
    const conn = makeLinkedInConn({
      id: "conn-x",
      platform: "x",
      is_personal_mode: false,
      external_account_id: null,
      display_name: "@opollo",
    } as Partial<SocialConnection>);
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    const row = screen.getByTestId(`connection-row-${conn.id}`);
    expect(row).toHaveTextContent("X");
    expect(row).not.toHaveTextContent("LinkedIn");
  });
});
