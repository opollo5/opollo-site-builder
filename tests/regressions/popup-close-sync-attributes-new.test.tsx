// @vitest-environment jsdom

import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — popup-close sync must pass attribute_new_to_company_id so
// that platforms whose OAuth does NOT redirect to our callback (e.g.
// X/Twitter going to bundle.social's own dashboard) still get a DB row
// created when the popup closes.
//
// Incident: 2026-05-13
// Steven connected X: popup opened, OAuth completed, popup closed.
// syncOnPopupClose fired but called POST /sync WITHOUT
// attribute_new_to_company_id. The sync found the new X account in
// bundle.social but skipped insertion (no attribution flag). No row
// appeared. Steven had to reconnect.
//
// Fix: syncOnPopupClose passes attribute_new_to_company_id: companyId
// when rowId is undefined (fresh connect, not reconnect).
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
import type { SocialConnection } from "@/lib/platform/social/connections/types";

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

// Helper: traverse the identity-confirm modal that now appears before every
// connect attempt. Tick the checkbox and click Continue.
function confirmIdentity() {
  fireEvent.click(screen.getByTestId("identity-confirm-checkbox"));
  fireEvent.click(screen.getByTestId("identity-confirm-continue"));
}

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";

function renderList(connections: SocialConnection[] = []) {
  return render(
    <SocialConnectionsList
      companyId={COMPANY_ID}
      profileId="00000000-0000-0000-0000-000000000002"
      connections={connections}
      canManage={true}
      canReconnect={true}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
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

describe("R-POPUP-SYNC-ATTRIBUTION: popup-close sync passes attribute_new_to_company_id for fresh connects", () => {
  it("fresh connect (no rowId): sync body includes attribute_new_to_company_id", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      // preflight
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { warn: false, others: [] } }), {
          status: 200, headers: { "content-type": "application/json" },
        }),
      )
      // connect → URL
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://twitter.com/oauth?state=abc" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // sync call (popup close)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 1, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-TWITTER"));
    confirmIdentity();

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    // Popup closes without postMessage (bundle.social dashboard redirect).
    fakePopup.closed = true;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const syncCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    expect(syncCall).toBeDefined();
    const body = JSON.parse((syncCall![1] as RequestInit).body as string) as Record<string, unknown>;

    expect(body.company_id).toBe(COMPANY_ID);
    // KEY assertion: attribution flag must be present for fresh connects.
    expect(body.attribute_new_to_company_id).toBe(COMPANY_ID);
  });

  it("reconnect (rowId present): sync body does NOT include attribute_new_to_company_id", async () => {
    const existingConn: SocialConnection = {
      id: "conn-existing",
      company_id: COMPANY_ID,
      profile_id: "00000000-0000-0000-0000-000000000002",
      platform: "x",
      bundle_social_account_id: "bs-x",
      display_name: "@opollo",
      avatar_url: null,
      status: "auth_required",
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
    };

    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      // reconnect → URL
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { url: "https://twitter.com/oauth?state=reconnect" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // sync call (popup close — reconnect path)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 0, updated: 1, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList([existingConn]);

    // Click Reconnect on the existing row.
    const reconnectBtn = screen.getByTestId(`connection-reconnect-${existingConn.id}`);
    fireEvent.click(reconnectBtn);

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    fakePopup.closed = true;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const syncCall = fetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    expect(syncCall).toBeDefined();
    const body = JSON.parse((syncCall![1] as RequestInit).body as string) as Record<string, unknown>;

    expect(body.company_id).toBe(COMPANY_ID);
    // Reconnects must NOT pass attribution — row already exists.
    expect(body.attribute_new_to_company_id).toBeUndefined();
  });

  it("postMessage success path: sync still does NOT include attribution (callback already ran)", async () => {
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
          JSON.stringify({ ok: true, data: { url: "https://facebook.com/oauth?state=fb" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-FACEBOOK"));
    confirmIdentity();

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    // Callback fires postMessage success → clearPopupState() stops the poll.
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "bundle-connect-complete", connect: "success" },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    // When postMessage fires (happy path), syncOnPopupClose is NOT called
    // at all (poll was cleared). Verify no sync call.
    const syncCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    expect(syncCalls.length).toBe(0);
  });
});
