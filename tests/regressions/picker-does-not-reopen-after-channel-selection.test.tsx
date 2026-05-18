// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialConnection } from "@/lib/platform/social/connections/types";

// ---------------------------------------------------------------------------
// REGRESSION — ChannelPickerModal must NOT re-open after the user has
// already seen and dismissed it for a given connection.
//
// Bug: after selecting a channel, router.refresh() delivered the updated
// connections prop. The pending_identity row was still present momentarily
// (before the refresh completed), causing the auto-open effect to fire
// again and re-show the picker on top of the now-healthy connection.
//
// Root cause: the handleMessage path (postMessage connect=needs_channel)
// called setPickerForConnectionId without first adding the connection_id
// to pickerShownRef. On the next render tick the auto-open effect saw a
// pending_identity row whose id was not in pickerShownRef and re-opened.
//
// Fix: both paths that open the picker now add the connection_id to
// pickerShownRef before calling setPickerForConnectionId, so any
// subsequent render with the same pending_identity row is a no-op.
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

import { SocialConnectionsList } from "@/components/SocialConnectionsList";

const fetchMock = vi.fn();
const openMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_OPEN = window.open;

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const PROFILE_ID = "00000000-0000-0000-0000-000000000002";
const CONN_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function makeConn(
  status: "pending_identity" | "healthy",
): SocialConnection {
  const now = new Date().toISOString();
  return {
    id: CONN_ID,
    company_id: COMPANY_ID,
    profile_id: PROFILE_ID,
    platform: "linkedin_personal",
    bundle_social_account_id: "bs-li",
    display_name: null,
    avatar_url: null,
    status,
    last_error: null,
    connected_at: now,
    disconnected_at: null,
    last_health_check_at: now,
    external_account_id: null,
    external_user_id: null,
    external_identity_hash: null,
    is_personal_mode: false,
    has_emitted_overdue_event: false,
    created_at: now,
    updated_at: now,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, data: { channels: [] } }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  );
  openMock.mockReset();
  openMock.mockReturnValue({ closed: false, focus: vi.fn(), location: { href: "" } });
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: openMock });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: ORIGINAL_OPEN });
  vi.clearAllMocks();
});

function confirmIdentity() {
  fireEvent.click(screen.getByTestId("identity-confirm-checkbox"));
  fireEvent.click(screen.getByTestId("identity-confirm-continue"));
}

describe("R-PICKER-REOPEN: channel picker stays closed after postMessage needs_channel + prop update", () => {
  it("picker does not re-open when connections re-renders with the same pending_identity row", async () => {
    // Set up a full connect flow so busyPlatformRef is populated when
    // the postMessage fires (the listener gates on an active connect).
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://linkedin.com/oauth?state=abc" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // channels endpoint (fired when picker opens)
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true, data: { channels: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      );

    const { rerender } = render(
      <SocialConnectionsList
        companyId={COMPANY_ID}
        profileId={PROFILE_ID}
        connections={[]}
        canManage={true}
        canReconnect={true}
      />,
    );

    // Start the connect flow so busyPlatformRef is set.
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));
    confirmIdentity();
    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    // Simulate callback postMessaging needs_channel.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "bundle-connect-complete",
            connect: "needs_channel",
            connection_id: CONN_ID,
          },
        }),
      );
    });

    // Picker is open.
    expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();

    // User selects a channel — picker closes.
    fireEvent.click(screen.getByTestId("channel-picker-close"));
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();

    // router.refresh() delivers the updated connections prop.
    // The row is still pending_identity (the DB hasn't flipped yet).
    await act(async () => {
      rerender(
        <SocialConnectionsList
          companyId={COMPANY_ID}
          profileId={PROFILE_ID}
          connections={[makeConn("pending_identity")]}
          canManage={true}
          canReconnect={true}
        />,
      );
    });

    // Picker must NOT re-open. pickerShownRef guards the auto-open effect.
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });

  it("picker does not re-open after mount-time auto-open on pending_identity", async () => {
    const { rerender } = render(
      <SocialConnectionsList
        companyId={COMPANY_ID}
        profileId={PROFILE_ID}
        connections={[makeConn("pending_identity")]}
        canManage={true}
        canReconnect={true}
      />,
    );

    // Picker opens automatically on mount.
    await act(async () => {});
    expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();

    // User closes/selects a channel.
    fireEvent.click(screen.getByTestId("channel-picker-close"));
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();

    // Second render with the same pending_identity row (refresh before status flips).
    await act(async () => {
      rerender(
        <SocialConnectionsList
          companyId={COMPANY_ID}
          profileId={PROFILE_ID}
          connections={[makeConn("pending_identity")]}
          canManage={true}
          canReconnect={true}
        />,
      );
    });

    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });
});
