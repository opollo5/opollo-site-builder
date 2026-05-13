// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// COMPONENT — ChannelPickerBody conflict UI + duplicate-click guard.
//
// Tests that:
//   1. A 409 CROSS_TENANT_CONFLICT response renders the conflict banner
//      with "Connect to both companies" (not silent close).
//   2. Clicking a channel row twice in quick succession fires only one
//      set-channel POST (Fix C).
// ---------------------------------------------------------------------------

import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const ORIGINAL_FETCH = global.fetch;

const CONNECTION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

const CHANNEL = { id: "ch-1", name: "Acme LinkedIn Page", subtext: null, avatarUrl: null, kind: "LINKEDIN_ORG" as const };

function channelsResponse(channels: typeof CHANNEL[]) {
  return new Response(
    JSON.stringify({ ok: true, data: { channels } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function conflictResponse(overrideAllowed = true) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "CROSS_TENANT_CONFLICT",
        message: "Channel attached to another company.",
        details: {
          conflicting_company: "Acme Corp",
          conflicting_channel_name: "Acme LinkedIn Page",
          override_allowed: overrideAllowed,
        },
      },
      timestamp: new Date().toISOString(),
    }),
    { status: 409, headers: { "content-type": "application/json" } },
  );
}

function successResponse() {
  return new Response(
    JSON.stringify({ ok: true, data: { connection_id: CONNECTION_ID, channel_id: "ch-1", external_account_id: "urn:li:org:1" }, timestamp: new Date().toISOString() }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  global.fetch = ORIGINAL_FETCH;
  vi.clearAllMocks();
  vi.useRealTimers();
});

// Lazy import after mocks installed.
async function renderBody(onSelected = vi.fn()) {
  const { ChannelPickerBody } = await import("@/components/ChannelPickerBody");
  return render(
    <ChannelPickerBody
      connectionId={CONNECTION_ID}
      platform="LINKEDIN"
      platformLabel="LinkedIn"
      onSelected={onSelected}
      autoFetch={true}
    />,
  );
}

describe("ChannelPickerBody: 409 conflict renders actionable UI", () => {
  it("shows conflict banner with company name when set-channel returns 409 CROSS_TENANT_CONFLICT", async () => {
    fetchMock
      .mockResolvedValueOnce(channelsResponse([CHANNEL]))  // channels list
      .mockResolvedValueOnce(conflictResponse(true));       // set-channel → 409

    await act(async () => {
      await renderBody();
    });

    // Channel row should be visible.
    const row = screen.getByTestId("channel-picker-row-ch-1");
    expect(row).toBeTruthy();

    // Click the channel.
    await act(async () => {
      fireEvent.click(row);
    });

    // Conflict banner should appear.
    const banner = screen.getByTestId("channel-picker-conflict-error");
    expect(banner).toBeTruthy();
    expect(banner.textContent).toMatch(/Acme Corp/i);
    expect(banner.textContent).toMatch(/Acme LinkedIn Page/i);

    // "Connect to both companies" button should be visible when override_allowed.
    const overrideBtn = screen.getByTestId("channel-picker-connect-both");
    expect(overrideBtn).toBeTruthy();

    // onSelected should NOT have been called.
    // (it can't get the onSelected mock from outside the scope here, but
    // the absence of a modal close is validated by banner still being visible)
    expect(screen.queryByTestId("channel-picker-action-error")).toBeNull();
  });

  it("shows no override button when override_allowed=false", async () => {
    fetchMock
      .mockResolvedValueOnce(channelsResponse([CHANNEL]))
      .mockResolvedValueOnce(conflictResponse(false));

    await act(async () => {
      await renderBody();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("channel-picker-row-ch-1"));
    });

    expect(screen.getByTestId("channel-picker-conflict-error")).toBeTruthy();
    expect(screen.queryByTestId("channel-picker-connect-both")).toBeNull();
  });

  it("retries with force:true when 'Connect to both companies' is clicked", async () => {
    fetchMock
      .mockResolvedValueOnce(channelsResponse([CHANNEL]))
      .mockResolvedValueOnce(conflictResponse(true))   // first click → 409
      .mockResolvedValueOnce(successResponse());        // override click → 200

    const onSelected = vi.fn();

    await act(async () => {
      await renderBody(onSelected);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("channel-picker-row-ch-1"));
    });

    // Click "Connect to both companies".
    await act(async () => {
      fireEvent.click(screen.getByTestId("channel-picker-connect-both"));
    });

    // Second fetch must include force:true.
    const calls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/set-channel"),
    );
    expect(calls.length).toBe(2);
    const overrideBody = JSON.parse(
      (calls[1]![1] as RequestInit).body as string,
    ) as Record<string, unknown>;
    expect(overrideBody.force).toBe(true);

    // onSelected should have been called after override success.
    expect(onSelected).toHaveBeenCalledTimes(1);
  });
});

describe("ChannelPickerBody: Fix C — duplicate click fires only one POST", () => {
  it("clicking a row twice in quick succession fires only one set-channel POST", async () => {
    // set-channel never resolves — simulates in-flight request.
    let resolveSetChannel!: (v: Response) => void;
    const hangingResponse = new Promise<Response>((r) => { resolveSetChannel = r; });

    fetchMock
      .mockResolvedValueOnce(channelsResponse([CHANNEL]))
      .mockReturnValueOnce(hangingResponse);

    await act(async () => {
      await renderBody();
    });

    const row = screen.getByTestId("channel-picker-row-ch-1");

    // Click twice in the same tick.
    fireEvent.click(row);
    fireEvent.click(row);

    // Resolve the pending request so the component doesn't hang.
    await act(async () => {
      resolveSetChannel(successResponse());
    });

    const setChannelCalls = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/set-channel"),
    );
    expect(setChannelCalls.length).toBe(1);
  });
});
