// @vitest-environment jsdom

import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION R-X-SYNC-RETRY — when popup-close sync returns inserted=0 on
// a fresh connect, one retry must fire ~3 s later.
//
// Incident: 2026-05-13
// X/Twitter OAuth completed (popup closed), syncOnPopupClose fired
// immediately, but bundle.social hadn't yet finished processing the OAuth
// grant. teamGetTeam returned an empty socialAccounts list → inserted=0.
// No row appeared. Steven had to reconnect.
//
// Fix: if the first sync finds inserted=0 on a fresh connect (no rowId),
// the component schedules a single retry after 3 s. This test pins that
// the retry call fires and carries attribute_new_to_company_id.
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

function makeFakePopup() {
  return {
    closed: false,
    focus: vi.fn(),
    location: { href: "" },
    close() { (this as { closed: boolean }).closed = true; },
  };
}

function renderList() {
  return render(
    <SocialConnectionsList
      companyId={COMPANY_ID}
      profileId="00000000-0000-0000-0000-000000000002"
      connections={[]}
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

describe("R-X-SYNC-RETRY: popup-close sync retries when first sync inserts nothing", () => {
  it("fresh connect: retry sync fires after 3 s when initial sync returns inserted=0", async () => {
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
      // first sync — inserted=0 (bundle.social async processing not done)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 0, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // retry sync — inserted=1 (bundle.social finished)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 1, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-TWITTER"));

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    // Popup closes without postMessage.
    fakePopup.closed = true;

    // First poll tick fires at 500ms → syncOnPopupClose → first sync call.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const syncCallsAfterFirst = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    expect(syncCallsAfterFirst.length).toBe(1);

    // Advance past the 3-second retry delay.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    const allSyncCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    // KEY assertion: exactly 2 sync calls — initial + retry.
    expect(allSyncCalls.length).toBe(2);

    // The retry must carry attribute_new_to_company_id.
    const retryCall = allSyncCalls[1];
    const retryBody = JSON.parse((retryCall[1] as RequestInit).body as string) as Record<string, unknown>;
    expect(retryBody.attribute_new_to_company_id).toBe(COMPANY_ID);
  });

  it("fresh connect: NO retry when first sync already inserted rows", async () => {
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
      )
      // first sync — inserted=1 (callback already ran for LinkedIn, normal path)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 1, updated: 0, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    fakePopup.closed = true;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    // Advance past the potential retry window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    const allSyncCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    // Only the initial sync — no retry because inserted=1.
    expect(allSyncCalls.length).toBe(1);
  });

  it("reconnect (rowId present): no retry even when inserted=0", async () => {
    const existingConn = {
      id: "conn-x",
      company_id: COMPANY_ID,
      profile_id: "00000000-0000-0000-0000-000000000002",
      platform: "x" as const,
      bundle_social_account_id: "bs-x",
      display_name: "@opollo",
      avatar_url: null,
      status: "auth_required" as const,
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
      // sync (reconnect path — no attribution)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { inserted: 0, updated: 1, marked_disconnected: 0, unmapped_skipped: 0, cross_tenant_blocked: 0 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    render(
      <SocialConnectionsList
        companyId={COMPANY_ID}
        profileId="00000000-0000-0000-0000-000000000002"
        connections={[existingConn]}
        canManage={true}
        canReconnect={true}
      />,
    );

    fireEvent.click(screen.getByTestId(`connection-reconnect-${existingConn.id}`));

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    fakePopup.closed = true;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    const allSyncCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/connections/sync"),
    );
    // Reconnect path: rowId is set → no retry regardless of inserted count.
    expect(allSyncCalls.length).toBe(1);
  });
});
