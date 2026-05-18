import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SocialConnectionsList } from "@/components/SocialConnectionsList";

// ---------------------------------------------------------------------------
// 2026-05-13 — Connect dropdown menu render + click behaviour.
//
// The platform-picker was a 3-column tile grid (PR #880). It's now a
// Popover dropdown — click "Connect new account" → menu opens → menu
// items are role="menuitem" with the same data-testid="connect-platform-
// <KEY>" so the existing e2e selectors and the OAuth click path still work.
//
// Asserts:
//   1. Clicking "Connect new account" opens the popover; all 10 platform
//      menu items render with icon + label.
//   2. Each menu item carries an accessible name 'Connect <platform>'.
//   3. Clicking a menu item triggers the OAuth handler (preflight GET +
//      connect POST + window.open).
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

// 2026-05-13: trimmed from 10 → 5. TikTok, Pinterest, Threads, Reddit,
// and YouTube were removed from the UI surface.
const PLATFORMS = [
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "TWITTER",
  "GOOGLE_BUSINESS",
] as const;

const PLATFORM_LABEL: Record<string, string> = {
  LINKEDIN: "LinkedIn",
  FACEBOOK: "Facebook",
  INSTAGRAM: "Instagram",
  TWITTER: "X (Twitter)",
  GOOGLE_BUSINESS: "Google Business",
};

const REMOVED_PLATFORMS = ["TIKTOK", "PINTEREST", "THREADS", "REDDIT"] as const;

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  // Default popup mock — returns a fake window with a no-op close().
  openMock.mockReturnValue({ closed: false, focus: vi.fn(), location: { href: "" } });
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

describe("SocialConnectionsList — Connect dropdown", () => {
  it("renders only the 5 supported platform menu items when the popover opens", () => {
    renderList();

    // Click trigger to open the popover. Radix portals the content
    // into document.body — testing-library queries against the document
    // by default so getByTestId still resolves.
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    expect(screen.getByTestId("connect-platform-menu")).toBeInTheDocument();

    for (const platform of PLATFORMS) {
      const item = screen.getByTestId(`connect-platform-${platform}`);
      expect(item).toBeInTheDocument();
      // Each item shows the platform label as a text node.
      expect(item).toHaveTextContent(PLATFORM_LABEL[platform]!);
      // And renders an inline SVG icon (brand glyph).
      const svg = item.querySelector("svg");
      expect(svg).not.toBeNull();
      // And is a menuitem.
      expect(item.getAttribute("role")).toBe("menuitem");
    }
  });

  it("does NOT render removed platforms (TikTok / Pinterest / Threads / Reddit)", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));

    for (const removed of REMOVED_PLATFORMS) {
      expect(
        screen.queryByTestId(`connect-platform-${removed}`),
      ).toBeNull();
    }
  });

  it("each menu item carries an accessible name 'Connect <platform>'", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));

    for (const platform of PLATFORMS) {
      const item = screen.getByLabelText(
        `Connect ${PLATFORM_LABEL[platform]}`,
      );
      expect(item).toBe(screen.getByTestId(`connect-platform-${platform}`));
    }
  });

  it("trigger button is aria-haspopup=menu and aria-expanded reflects open state", () => {
    renderList();
    const trigger = screen.getByTestId("connections-connect-button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("clicking a menu item triggers the OAuth handler (preflight + connect POST + window.open)", async () => {
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
    // Dismiss the identity confirm modal so the OAuth flow proceeds.
    fireEvent.click(screen.getByTestId("identity-confirm-checkbox"));
    fireEvent.click(screen.getByTestId("identity-confirm-continue"));

    // Flush the preflight + connect fetch chain. The pre-popup is opened
    // synchronously (blank URL), then navigated via popup.location.href.
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/api/platform/social/connections/identity-preflight",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/platform/social/connections/connect",
    );

    const connectInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const body = connectInit?.body
      ? (JSON.parse(connectInit.body as string) as Record<string, unknown>)
      : null;
    expect(body).toEqual({
      company_id: "00000000-0000-0000-0000-000000000001",
      profile_id: "00000000-0000-0000-0000-000000000002",
      platform: "FACEBOOK",
    });

    // Bug 1 fix: popup is pre-opened with blank URL then navigated in-place.
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith("", "bundle-connect", expect.any(String));
    const fakeResult = openMock.mock.results[0]?.value as { location: { href: string } } | null;
    expect(fakeResult?.location.href).toBe("https://www.facebook.com/v23.0/dialog/oauth?xyz=1");
  });
});
