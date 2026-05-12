import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PopupChannelPicker } from "@/components/PopupChannelPicker";

// ---------------------------------------------------------------------------
// 2026-05-13 — PopupChannelPicker (in-popup channel picker page body).
//
// Asserts:
//   1. Renders header with platform label + icon.
//   2. On Cancel click → window.opener.postMessage + window.close.
//   3. When the channel-list endpoint returns a channel and the user
//      selects it → set-channel POST → postMessage(success) + close.
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();
const postMessageMock = vi.fn();
const closeMock = vi.fn();
const originalFetch = global.fetch;

const ORIGIN = "https://example.test";

beforeEach(() => {
  fetchMock.mockReset();
  postMessageMock.mockReset();
  closeMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  Object.defineProperty(window, "opener", {
    configurable: true,
    writable: true,
    value: { closed: false, postMessage: postMessageMock },
  });
  // Override window.close to no-op + spy.
  Object.defineProperty(window, "close", {
    configurable: true,
    writable: true,
    value: closeMock,
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

function renderPicker() {
  return render(
    <PopupChannelPicker
      connectionId="aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
      platform="LINKEDIN"
      platformLabel="LinkedIn"
      origin={ORIGIN}
    />,
  );
}

describe("PopupChannelPicker", () => {
  it("renders the header with platform label and a brand icon", () => {
    // Block the channel-list fetch so we don't race the assertions.
    fetchMock.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    renderPicker();
    expect(screen.getByTestId("popup-channel-picker")).toBeInTheDocument();
    expect(screen.getByText("Pick a LinkedIn channel")).toBeInTheDocument();
    // The header carries a brand SVG.
    const header = screen.getByText("Pick a LinkedIn channel").parentElement;
    expect(header?.querySelector("svg")).not.toBeNull();
  });

  it("Cancel fires postMessage with noop + reason=user-cancelled, then closes", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    renderPicker();

    fireEvent.click(screen.getByTestId("popup-picker-cancel"));

    expect(postMessageMock).toHaveBeenCalledTimes(1);
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bundle-connect-complete",
        connect: "noop",
        reason: "user-cancelled",
        connection_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      }),
      ORIGIN,
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("selecting a channel calls set-channel and posts success + closes", async () => {
    // 1st fetch: channel list. 2nd fetch: set-channel.
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              channels: [
                {
                  id: "urn:li:organization:42",
                  name: "Test Co",
                  subtext: "test-co",
                  avatarUrl: null,
                  kind: "LINKEDIN_ORG",
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    renderPicker();

    // Wait for the channel row to render.
    await vi.waitFor(() => {
      expect(
        screen.getByTestId("channel-picker-row-urn:li:organization:42"),
      ).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByTestId("channel-picker-row-urn:li:organization:42"),
    );

    await vi.waitFor(() => {
      expect(postMessageMock).toHaveBeenCalled();
    });

    // First call was channels list, second was set-channel.
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/set-channel");
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "bundle-connect-complete",
        connect: "success",
        connection_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      }),
      ORIGIN,
    );
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
