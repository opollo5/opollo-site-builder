// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — auto-open ChannelPickerModal for pending_identity connections.
//
// After OAuth completes with a channel-selection platform (LinkedIn, Facebook,
// GBP), the DB row lands in status='pending_identity'. On the next mount of
// SocialConnectionsList the modal MUST auto-open without user action.
//
// Critical pins:
//   - useRef<Set<string>> (not sessionStorage) so the shown-set resets on
//     page refresh (component remount), allowing the modal to reopen.
//   - Non-channel-selection platforms (x) must NOT trigger the modal even
//     if status is pending_identity.
//   - Dismissing the modal without picking must not reopen it during the
//     same component lifetime.
// ---------------------------------------------------------------------------

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

vi.mock("@/components/ChannelPickerModal", () => ({
  ChannelPickerModal: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div data-testid="channel-picker-modal">
        <button data-testid="picker-close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

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

function makeConn(overrides: Partial<SocialConnection> = {}): SocialConnection {
  return {
    id: "conn-1",
    company_id: "company-1",
    profile_id: "profile-1",
    platform: "linkedin_personal",
    bundle_social_account_id: "bs-1",
    display_name: "Test LinkedIn",
    avatar_url: null,
    status: "pending_identity",
    last_error: null,
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    last_health_check_at: new Date().toISOString(),
    external_account_id: null,
    external_user_id: null,
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

describe("R-AUTO-OPEN-PICKER: pending_identity rows auto-open ChannelPickerModal", () => {
  it("mount with pending_identity LinkedIn row → picker modal opens automatically", async () => {
    const conn = makeConn({ id: "conn-linkedin", platform: "linkedin_personal" });
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });
  });

  it("pending_identity X (Twitter) row → picker stays closed (not a channel-selection platform)", async () => {
    const conn = makeConn({ id: "conn-x", platform: "x", status: "pending_identity" });
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    await act(async () => {});
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });

  it("dismiss modal without picking → does NOT reopen during the same mount", async () => {
    const conn = makeConn({ id: "conn-linkedin", platform: "linkedin_personal" });
    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("picker-close"));

    await act(async () => {});
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });

  it("remount (page refresh) → modal reopens because useRef resets on unmount", async () => {
    const conn = makeConn({ id: "conn-linkedin", platform: "linkedin_personal" });
    const { unmount } = render(
      <SocialConnectionsList {...BASE_PROPS} connections={[conn]} />,
    );

    await vi.waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });

    unmount();

    render(<SocialConnectionsList {...BASE_PROPS} connections={[conn]} />);

    await vi.waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });
  });
});
