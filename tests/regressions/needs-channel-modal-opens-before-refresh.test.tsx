// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — ChannelPickerModal must open immediately when the popup
// postMessages connect=needs_channel, even before router.refresh() delivers
// the new connection in the `connections` prop.
//
// Incident: 2026-05-13
// Facebook OAuth completed → row inserted → callback postMessaged
// connect=needs_channel + connection_id. But pickerTarget returned null
// because connections prop was the pre-connect snapshot (no row found).
// Modal never opened. Steven had to manually click Refresh.
//
// Fix: pickerTarget falls back to busyPlatformRef.current (the platform
// the user clicked) when the connection isn't in the prop yet.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: mocks.refresh,
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
    connectionId,
    platform,
    platformLabel,
    onClose,
  }: {
    isOpen: boolean;
    connectionId: string;
    platform: string;
    platformLabel: string;
    onClose: () => void;
  }) =>
    isOpen ? (
      <div
        data-testid="channel-picker-modal"
        data-connection-id={connectionId}
        data-platform={platform}
        data-platform-label={platformLabel}
      >
        <button data-testid="picker-close" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

import { SocialConnectionsList } from "@/components/SocialConnectionsList";

const fetchMock = vi.fn();
const openMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_OPEN = window.open;

function makeFakePopup() {
  return {
    closed: false,
    focus: vi.fn(),
    location: { href: "" },
    close() { (this as { closed: boolean }).closed = true; },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  mocks.refresh.mockReset();
  openMock.mockReset();
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: openMock });
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: ORIGINAL_OPEN });
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderEmpty() {
  return render(
    <SocialConnectionsList
      companyId="00000000-0000-0000-0000-000000000001"
      profileId="00000000-0000-0000-0000-000000000002"
      connections={[]}
      canManage={true}
      canReconnect={true}
    />,
  );
}

function confirmIdentity() {
  fireEvent.click(screen.getByTestId("identity-confirm-checkbox"));
  fireEvent.click(screen.getByTestId("identity-confirm-continue"));
}

const CONN_ID = "20acab14-d422-463e-9920-297f998bce38";

describe("R-NEEDS-CHANNEL-RACE: modal opens immediately on needs_channel postMessage", () => {
  it("Facebook connect: modal opens before router.refresh() delivers the row", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      // preflight
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      )
      // connect → OAuth URL
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://facebook.com/oauth?state=abc" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderEmpty();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));
    confirmIdentity();

    // Flush preflight + connect fetches so window.open fires.
    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    // Simulate callback postMessaging needs_channel. connections prop is
    // still [] at this point (router.refresh() hasn't resolved).
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

    // Modal MUST be open immediately — without waiting for router.refresh()
    // to deliver the new connection in the connections prop.
    const modal = screen.getByTestId("channel-picker-modal");
    expect(modal).toBeInTheDocument();
    expect(modal.dataset.connectionId).toBe(CONN_ID);
    expect(modal.dataset.platform).toBe("FACEBOOK");
  });

  it("LinkedIn connect: modal opens before router.refresh() delivers the row", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

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
      );

    renderEmpty();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));
    confirmIdentity();

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

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

    const modal = screen.getByTestId("channel-picker-modal");
    expect(modal).toBeInTheDocument();
    expect(modal.dataset.platform).toBe("LINKEDIN");
  });

  it("Instagram connect: modal opens with INSTAGRAM platform label", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://facebook.com/oauth?state=ig" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderEmpty();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-INSTAGRAM"));
    confirmIdentity();

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

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

    const modal = screen.getByTestId("channel-picker-modal");
    expect(modal).toBeInTheDocument();
    // Instagram click → pickerPlatformOverride="INSTAGRAM"
    expect(modal.dataset.platform).toBe("INSTAGRAM");
  });

  it("success (no needs_channel): modal does NOT open before connections prop updates", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://x.com/oauth?state=abc" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderEmpty();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-TWITTER"));
    confirmIdentity();

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: window.location.origin,
          data: {
            type: "bundle-connect-complete",
            connect: "success",
          },
        }),
      );
    });

    // No needs_channel → picker should NOT open
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });
});
