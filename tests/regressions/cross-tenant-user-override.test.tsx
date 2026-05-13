// @vitest-environment jsdom

import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// REGRESSION — cross-tenant user override flow.
//
// Bug reported 2026-05-13: preflight warning modal "Continue" button
// discarded the user's override decision. The sync's Layer 2 block then
// rejected the account unconditionally (allow_cross_tenant_identity=false),
// and the failure was silent — the popup closed with no row and no error.
//
// Fix:
//   1. Preflight "I manage both" button passes forceCrossTenant:true to
//      handleConnect, which POSTs force_cross_tenant:true to /connect.
//      The callback URL encodes &cross_tenant_override=1 so the sync
//      bypasses the block.
//   2. If the block still fires (override not taken), the popup postMessage
//      reason=cross-tenant-blocked is surfaced as a visible error with
//      instructions to use "I manage both" next time.
//   3. forceCrossTenantRef is reset in clearPopupState so a subsequent
//      fresh connect doesn't carry the override unexpectedly.
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

function makeFakePopup() {
  return {
    closed: false,
    focus: vi.fn(),
    close() {
      (this as { closed: boolean }).closed = true;
    },
  };
}

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

beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: openMock,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: ORIGINAL_OPEN,
  });
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("R-CROSS-TENANT-OVERRIDE: preflight 'I manage both' sends force_cross_tenant to /connect", () => {
  it("clicking 'I manage both' in preflight modal includes force_cross_tenant:true in connect POST", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      // preflight → returns warn:true (cross-tenant conflict detected)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              warn: true,
              others: [
                { company_name: "Other Client", connected_at: new Date().toISOString() },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // connect → URL (fires after "I manage both" click)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: { url: "https://linkedin.com/oauth?state=abc" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    // Open platform picker and click LinkedIn.
    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    // Wait for preflight fetch to resolve and modal to render.
    await act(async () => {});

    const modal = screen.getByTestId("preflight-modal");
    expect(modal).toBeTruthy();

    // Click "I manage both" — should proceed with override.
    const continueBtn = screen.getByTestId("preflight-modal-continue");
    expect(continueBtn.textContent).toContain("I manage both");
    fireEvent.click(continueBtn);

    await act(async () => {});

    // The modal should have closed.
    expect(screen.queryByTestId("preflight-modal")).toBeNull();

    // Find the connect API call (second fetch: first was preflight).
    const connectCall = fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/connections/connect"),
    );
    expect(connectCall).toBeDefined();

    const body = JSON.parse(
      (connectCall![1] as RequestInit).body as string,
    ) as Record<string, unknown>;

    // KEY assertion: override flag must be present.
    expect(body.force_cross_tenant).toBe(true);
    expect(body.profile_id).toBe(PROFILE_ID);
    expect(body.platform).toBe("LINKEDIN");
  });
});

describe("R-CROSS-TENANT-OVERRIDE: cross-tenant-blocked postMessage surfaces visible error", () => {
  it("connect=error reason=cross-tenant-blocked renders actionable error banner", async () => {
    const fakePopup = makeFakePopup();
    openMock.mockReturnValue(fakePopup);

    fetchMock
      // preflight → clean (no warning)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ ok: true, data: { warn: false, others: [] } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      // connect → URL
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: { url: "https://linkedin.com/oauth?state=def" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    renderList();

    fireEvent.click(screen.getByTestId("connections-connect-button"));
    fireEvent.click(screen.getByTestId("connect-platform-LINKEDIN"));

    await act(async () => {});
    expect(openMock).toHaveBeenCalledTimes(1);

    // Callback emits cross-tenant-blocked via postMessage.
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "bundle-connect-complete",
          connect: "error",
          reason: "cross-tenant-blocked",
        },
      }),
    );

    await act(async () => {});

    // Error alert must be visible.
    const errorEl = screen.getByTestId("connections-error");
    expect(errorEl.textContent).toMatch(/already connected to another client/i);
    expect(errorEl.textContent).toMatch(/I manage both/i);
  });
});
