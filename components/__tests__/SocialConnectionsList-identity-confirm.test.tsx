// @vitest-environment jsdom

import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Component tests — identity confirm modal (Bug 2 / PR fix/social-connect-flow-bugs).
//
// Before this fix, clicking a platform button opened the OAuth popup directly.
// Now an intermediate modal requires the user to tick a checkbox confirming
// they are signed into the correct account before OAuth fires.
//
// Asserts:
//   1. Clicking a platform button shows the modal, NOT the popup.
//   2. Continue is disabled (aria-disabled) until the checkbox is ticked.
//   3. Ticking the checkbox enables Continue.
//   4. Cancel closes the modal without opening a popup.
//   5. Continue (with checkbox ticked) dismisses modal and starts OAuth.
//   6. The platform check link has the correct href.
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

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  openMock.mockReturnValue({ closed: false, focus: vi.fn(), location: { href: "" } });
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

function renderList() {
  return render(
    <SocialConnectionsList
      companyId={COMPANY_ID}
      profileId={PROFILE_ID}
      connections={[]}
      canManage={true}
      canReconnect={true}
    />,
  );
}

describe("SocialConnectionsList — identity confirm modal", () => {
  it("clicking a platform button shows the modal, not the popup", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    expect(screen.getByTestId("identity-confirm-modal")).toBeInTheDocument();
    expect(openMock).not.toHaveBeenCalled();
  });

  it("modal title shows the platform name", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-TWITTER"));

    expect(screen.getByTestId("identity-confirm-modal")).toHaveTextContent("X (Twitter)");
  });

  it("Continue button is disabled until checkbox is ticked", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));

    const continueBtn = screen.getByTestId("identity-confirm-continue");
    expect(continueBtn).toBeDisabled();
    expect(continueBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("ticking the checkbox enables Continue", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));

    fireEvent.click(screen.getByTestId("identity-confirm-checkbox"));
    const continueBtn = screen.getByTestId("identity-confirm-continue");
    expect(continueBtn).not.toBeDisabled();
  });

  it("Cancel closes the modal without opening a popup", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    expect(screen.getByTestId("identity-confirm-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("identity-confirm-cancel"));

    expect(screen.queryByTestId("identity-confirm-modal")).toBeNull();
    expect(openMock).not.toHaveBeenCalled();
  });

  it("Continue (checkbox ticked) dismisses modal and starts OAuth flow", async () => {
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

    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));
    fireEvent.click(screen.getByTestId("identity-confirm-checkbox"));
    fireEvent.click(screen.getByTestId("identity-confirm-continue"));

    expect(screen.queryByTestId("identity-confirm-modal")).toBeNull();

    await act(async () => {});

    // Popup was opened (pre-popup pattern: blank URL, then navigated).
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith("", "bundle-connect", expect.any(String));
    const popup = openMock.mock.results[0]?.value as { location: { href: string } } | null;
    expect(popup?.location.href).toBe("https://linkedin.com/oauth?state=abc");
  });

  it("LinkedIn check link points to linkedin.com/in/me", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    const link = screen.getByTestId("identity-confirm-check-link");
    expect(link.getAttribute("href")).toBe("https://www.linkedin.com/in/me/");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("Twitter check link points to x.com/settings/account", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-TWITTER"));

    const link = screen.getByTestId("identity-confirm-check-link");
    expect(link.getAttribute("href")).toBe("https://x.com/settings/account");
  });

  it("Facebook check link points to facebook.com/settings", () => {
    renderList();
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));

    const link = screen.getByTestId("identity-confirm-check-link");
    expect(link.getAttribute("href")).toBe("https://www.facebook.com/settings");
  });
});
