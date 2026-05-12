import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SocialConnectionsList } from "@/components/SocialConnectionsList";

// ---------------------------------------------------------------------------
// P1 — Connect tile grid render + click behaviour.
//
// Asserts:
//   1. Clicking "Connect new account" reveals the tile grid with all 10
//      platform tiles, each with the correct test-id, label, and SVG icon.
//   2. Clicking a tile calls runPreflight (GET) and then the connect POST.
//   3. The popup opens with the URL the route returned.
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/toast-success", () => ({
  toastSuccess: vi.fn(),
}));

const fetchMock = vi.fn();
const openMock = vi.fn();
const originalOpen = window.open;
const originalFetch = global.fetch;

const PLATFORMS = [
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "TWITTER",
  "GOOGLE_BUSINESS",
  "TIKTOK",
  "YOUTUBE",
  "PINTEREST",
  "THREADS",
  "REDDIT",
] as const;

const PLATFORM_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TWITTER: "X (Twitter)",
  GOOGLE_BUSINESS: "Google Business",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
  PINTEREST: "Pinterest",
  THREADS: "Threads",
  REDDIT: "Reddit",
};

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  // Default popup mock — returns a fake window with a no-op close().
  openMock.mockReturnValue({ closed: false, focus: vi.fn() });
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: openMock,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: originalOpen,
  });
  vi.clearAllMocks();
});

function renderList() {
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

describe("SocialConnectionsList — tile grid (P1)", () => {
  it("renders all 10 platform tiles when the lightbox opens", () => {
    renderList();

    // Open the lightbox.
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    expect(screen.getByTestId("connect-lightbox")).toBeInTheDocument();

    for (const platform of PLATFORMS) {
      const tile = screen.getByTestId(`connect-platform-${platform}`);
      expect(tile).toBeInTheDocument();
      // Each tile carries the platform label as a text node.
      expect(tile).toHaveTextContent(PLATFORM_LABEL[platform]!);
      // And renders an inline SVG icon (brand glyph).
      const svg = tile.querySelector("svg");
      expect(svg).not.toBeNull();
    }
  });

  it("each tile carries an accessible name 'Connect <platform>'", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));

    for (const platform of PLATFORMS) {
      const tile = screen.getByLabelText(
        `Connect ${PLATFORM_LABEL[platform]}`,
      );
      expect(tile).toBe(screen.getByTestId(`connect-platform-${platform}`));
    }
  });

  it("clicking a tile triggers the OAuth handler (preflight + connect POST + window.open)", async () => {
    // Pre-flight returns no warning, then connect returns an OAuth URL.
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { warn: false, others: [] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: { url: "https://www.facebook.com/v23.0/dialog/oauth?xyz=1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));

    // Wait for the two fetches and the window.open to fire.
    await vi.waitFor(() => {
      expect(openMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/platform/social/connections/identity-preflight",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/platform/social/connections/connect",
    );

    // Connect POST body shape.
    const connectInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const body = connectInit?.body
      ? (JSON.parse(connectInit.body as string) as Record<string, unknown>)
      : null;
    expect(body).toEqual({
      company_id: "00000000-0000-0000-0000-000000000001",
      profile_id: "00000000-0000-0000-0000-000000000002",
      platform: "FACEBOOK",
    });

    // window.open invoked with the URL the route returned + the popup name.
    expect(openMock).toHaveBeenCalledWith(
      "https://www.facebook.com/v23.0/dialog/oauth?xyz=1",
      "bundle-connect",
      expect.any(String),
    );
  });
});
