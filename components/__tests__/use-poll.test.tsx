import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePoll } from "@/lib/use-poll";

// ---------------------------------------------------------------------------
// usePoll — hook tests (RS-4)
//
// Covers: no-fetch-on-null-url, fetch-on-mount, error-handling, refresh().
// ---------------------------------------------------------------------------

type Payload = { status: string };

function makeFetch(response: Payload | null, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  } as Response);
}

describe("usePoll", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not fetch when url is null", async () => {
    const fetchSpy = makeFetch({ status: "ok" });
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => usePoll<Payload>(null));

    // No timers to advance — just ensure no fetch happened synchronously
    // and after a brief async drain.
    await act(async () => {});

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches on mount and populates data", async () => {
    const fetchSpy = makeFetch({ status: "running" });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePoll<Payload>("/api/test", { intervalMs: 60_000 }),
    );

    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(result.current.data).toEqual({ status: "running" });
    expect(result.current.error).toBeNull();
  });

  it("sets error on non-ok response", async () => {
    const fetchSpy = makeFetch(null, 500);
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePoll<Payload>("/api/test", { intervalMs: 60_000 }),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toMatch(/HTTP 500/);
  });

  it("refresh() triggers an additional fetch", async () => {
    const fetchSpy = makeFetch({ status: "idle" });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      usePoll<Payload>("/api/test", { intervalMs: 60_000 }),
    );

    // Wait for the initial mount fetch.
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const callsBefore = fetchSpy.mock.calls.length;

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("does not fetch when enabled is false", async () => {
    const fetchSpy = makeFetch({ status: "ok" });
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() =>
      usePoll<Payload>("/api/test", { intervalMs: 60_000, enabled: false }),
    );

    // Drain the micro-task queue — no timers to fire.
    await act(async () => {});

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
