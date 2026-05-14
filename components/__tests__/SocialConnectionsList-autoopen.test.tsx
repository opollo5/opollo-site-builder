// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// Regression: auto-open channel picker fires for facebook_page / instagram_business
// / gbp pending_identity rows, not just linkedin_personal.
//
// Bug: Facebook (and Instagram, GBP) did not auto-open the ChannelPickerModal
// after OAuth because the connections prop update from router.refresh() was not
// triggering the effect. LinkedIn worked because the postMessage path sent
// needs_channel directly; Facebook could also fall through to the auto-open
// effect, but it was untested.
//
// These tests cover:
//   1. Mount-time auto-open: when connections contains a pending_identity row
//      for any channel-selection platform, the modal opens immediately.
//   2. postMessage path: when connect:"needs_channel" arrives from the OAuth
//      popup, the modal opens for Facebook (was the primary breakage path in
//      AdminProfileConnectionsList — guarded here against regression in
//      SocialConnectionsList too).
// ---------------------------------------------------------------------------

import { act, cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialConnection } from "@/lib/platform/social/connections/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/toast-success", () => ({
  toastSuccess: vi.fn(),
}));

const fetchMock = vi.fn();
const openMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;
const originalOpen = window.open;

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const PROFILE_ID = "00000000-0000-0000-0000-000000000002";

function channelsOkResponse() {
  return new Response(
    JSON.stringify({ ok: true, data: { channels: [] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function preflightOkResponse() {
  return new Response(
    JSON.stringify({ ok: true, data: { warn: false, others: [] } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function connectOkResponse(url = "https://oauth.example.com/connect") {
  return new Response(
    JSON.stringify({ ok: true, data: { url } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function makeConn(
  id: string,
  platform: string,
  status: "pending_identity" | "healthy" = "pending_identity",
): SocialConnection {
  const now = new Date().toISOString();
  return {
    id,
    company_id: COMPANY_ID,
    profile_id: PROFILE_ID,
    platform: platform as SocialConnection["platform"],
    bundle_social_account_id: `bsa-${id}`,
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
  // Default: channels endpoint returns empty list.
  fetchMock.mockResolvedValue(channelsOkResponse());
  global.fetch = fetchMock as unknown as typeof fetch;

  openMock.mockReset();
  openMock.mockReturnValue({ closed: false, focus: vi.fn() });
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: openMock,
  });
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: originalOpen,
  });
  vi.clearAllMocks();
});

async function renderList(connections: SocialConnection[]) {
  const { SocialConnectionsList } = await import("@/components/SocialConnectionsList");
  return render(
    <SocialConnectionsList
      companyId={COMPANY_ID}
      profileId={PROFILE_ID}
      connections={connections}
      canManage={true}
      canReconnect={true}
    />,
  );
}

// ---------------------------------------------------------------------------
// Suite 1 — mount-time auto-open
// ---------------------------------------------------------------------------

describe("SocialConnectionsList — auto-open picker on mount", () => {
  it("opens modal for linkedin_personal pending_identity (control)", async () => {
    await act(async () => {
      await renderList([makeConn("li-1", "linkedin_personal")]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });

    expect(screen.getByTestId("channel-picker-title")).toHaveTextContent(
      "Pick a LinkedIn channel",
    );
  });

  it("opens modal for facebook_page pending_identity", async () => {
    await act(async () => {
      await renderList([makeConn("fb-1", "facebook_page")]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });

    expect(screen.getByTestId("channel-picker-title")).toHaveTextContent(
      "Pick a Facebook channel",
    );
  });

  it("opens modal for instagram_business pending_identity", async () => {
    await act(async () => {
      await renderList([makeConn("ig-1", "instagram_business")]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });

    // Instagram copy differs — check for the Instagram-specific title text
    expect(screen.getByTestId("channel-picker-title")).toHaveTextContent(
      "Pick a Facebook Page connected to your Instagram account",
    );
  });

  it("opens modal for gbp pending_identity", async () => {
    await act(async () => {
      await renderList([makeConn("gbp-1", "gbp")]);
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });

    expect(screen.getByTestId("channel-picker-title")).toHaveTextContent(
      "Pick a Google Business channel",
    );
  });

  it("does NOT open modal for x (Twitter) — not a channel-selection platform", async () => {
    // x goes straight to healthy; pending_identity is technically possible
    // but the map entry is null so the picker must not auto-open.
    const conn = makeConn("x-1", "x");
    conn.status = "pending_identity";

    await act(async () => {
      await renderList([conn]);
    });

    // Give the effect time to run.
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });

  it("does NOT open modal for healthy connections", async () => {
    const conn = makeConn("fb-1", "facebook_page", "healthy");

    await act(async () => {
      await renderList([conn]);
    });

    await new Promise<void>((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("channel-picker-modal")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — postMessage needs_channel path
// ---------------------------------------------------------------------------

describe("SocialConnectionsList — postMessage needs_channel auto-open", () => {
  it("opens modal when OAuth popup sends needs_channel for Facebook", async () => {
    // Start with no connections; the new facebook_page row isn't in the
    // connections prop yet (router.refresh() is mocked as a no-op).
    fetchMock
      .mockResolvedValueOnce(preflightOkResponse())         // preflight
      .mockResolvedValueOnce(connectOkResponse())           // /connect POST
      .mockResolvedValue(channelsOkResponse());             // channels (modal)

    await act(async () => {
      await renderList([]);
    });

    // Click "Connect new account" then pick Facebook.
    await act(async () => {
      fireEvent.click(screen.getByTestId("connections-connect-button"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));
    });

    // Wait for the connect POST to fire and the popup to open.
    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1);
    });

    // Simulate the OAuth callback postMessage.
    const CONNECTION_ID = "aaaaaaaa-bbbb-4111-8111-cccccccccccc";
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "bundle-connect-complete",
            connect: "needs_channel",
            connection_id: CONNECTION_ID,
          },
          origin: window.location.origin,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });
  });

  it("opens modal when OAuth popup sends needs_channel for LinkedIn (control)", async () => {
    fetchMock
      .mockResolvedValueOnce(preflightOkResponse())
      .mockResolvedValueOnce(connectOkResponse())
      .mockResolvedValue(channelsOkResponse());

    await act(async () => {
      await renderList([]);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("connections-connect-button"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));
    });

    await waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1);
    });

    const CONNECTION_ID = "aaaaaaaa-bbbb-4111-8111-dddddddddddd";
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "bundle-connect-complete",
            connect: "needs_channel",
            connection_id: CONNECTION_ID,
          },
          origin: window.location.origin,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("channel-picker-modal")).toBeInTheDocument();
    });
  });
});
