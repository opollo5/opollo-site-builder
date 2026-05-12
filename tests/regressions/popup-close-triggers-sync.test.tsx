import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SocialConnectionsList } from "@/components/SocialConnectionsList";

// ---------------------------------------------------------------------------
// REGRESSION — when bundle.social redirects the OAuth popup to their own
// dashboard instead of our /callback URL, no postMessage fires. The popup
// closes manually. The component must trigger a sync on popup-close so
// that bundle.social-created connections land in our DB even without a
// callback hit. (incident 2026-05-13-bundlesocial-direct-oauth-dashboard-redirect.md)
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

// Simulated popup object: starts open, can be programmatically closed.
function makeFakePopup() {
  const popup = { closed: false, focus: vi.fn(), close() { this.closed = true; } };
  return popup;
}

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: openMock });
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  global.fetch = originalFetch;
  Object.defineProperty(window, "open", { configurable: true, writable: true, value: originalOpen });
  vi.clearAllMocks();
  vi.useRealTimers();
});

function renderList(connections = []) {
  return render(
    <SocialConnectionsList
      companyId="00000000-0000-0000-0000-000000000001"
      profileId="00000000-0000-0000-0000-000000000002"
      connections={connections}
      canManage={true}
      canReconnect={true}
    />,
  );
}

describe("R-POPUP-SYNC: sync fires when popup closes without postMessage", () => {
  it("POSTs /sync when popup closes (no postMessage — bundle.social dashboard path)", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    // Pre-flight returns no-warn; connect returns a URL.
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://www.linkedin.com/oauth/v2/authorization?state=oauth:abc" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // sync call (triggered on popup close)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 0, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    // Open platform picker and click LinkedIn
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    // Wait for the popup to be opened
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));

    // Simulate popup closing (user closes bundle.social dashboard manually)
    fakePopup.closed = true;

    // Advance timer by 600ms to trigger the popup-close poll
    await vi.advanceTimersByTimeAsync(600);

    // Sync endpoint must be called
    await waitFor(() => {
      const syncCalls = fetchMock.mock.calls.filter(
        (c) =>
          typeof c[0] === "string" &&
          (c[0] as string).includes("/connections/sync"),
      );
      expect(syncCalls.length).toBeGreaterThan(0);
    });

    // Verify the sync call used POST with the right company_id
    const syncCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    expect(syncCall).toBeDefined();
    const syncInit = syncCall![1] as RequestInit;
    expect(syncInit.method).toBe("POST");
    const syncBody = JSON.parse(syncInit.body as string) as Record<string, unknown>;
    expect(syncBody.company_id).toBe("00000000-0000-0000-0000-000000000001");
  });

  it("does NOT call /sync when popup closes via postMessage (happy path — sync already ran in callback)", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://www.facebook.com/v23.0/dialog/oauth?state=oauth:xyz" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));

    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));

    // Simulate our callback firing a postMessage (happy path).
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "bundle-connect-complete",
          connect: "success",
        },
      }),
    );

    // The postMessage handler clears the poll immediately. Advancing
    // the timer should NOT trigger a sync call.
    await vi.advanceTimersByTimeAsync(600);

    const syncCalls = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/connections/sync"),
    );
    // No sync call — the callback route already handled the sync.
    expect(syncCalls.length).toBe(0);
  });
});
