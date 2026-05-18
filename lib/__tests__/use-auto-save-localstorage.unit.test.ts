// @vitest-environment jsdom

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useAutoSave } from "@/lib/hooks/use-auto-save";

// ---------------------------------------------------------------------------
// Unit tests — useAutoSave localStorage backup (FIX 11).
//
// Uses flush() directly to avoid fake-timer complexity with setInterval.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hooks/use-tab-leader", () => ({
  useTabLeader: () => ({ isLeader: true }),
}));

vi.mock("@/lib/hooks/use-session-grace", () => ({
  useSessionGrace: () => ({ status: "active", minutesRemaining: null }),
}));

const LS_KEY = "autosave_backup:test-key-123";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("useAutoSave localStorage backup", () => {
  it("writes to localStorage after a successful flush when localStorageBackup=true", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const getValue = vi.fn().mockReturnValue({ version: 1, data: "hello" });

    const { result } = renderHook(() =>
      useAutoSave({
        key: "test-key-123",
        getValue,
        save,
        enabled: true,
        localStorageBackup: true,
      }),
    );

    await act(async () => {
      await result.current.flush();
    });

    expect(save).toHaveBeenCalled();
    expect(localStorage.getItem(LS_KEY)).toBe(JSON.stringify({ version: 1, data: "hello" }));
  });

  it("does NOT write to localStorage when localStorageBackup=false (default)", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const getValue = vi.fn().mockReturnValue({ version: 1, data: "hello" });

    const { result } = renderHook(() =>
      useAutoSave({
        key: "test-key-123",
        getValue,
        save,
        enabled: true,
        // localStorageBackup not set — defaults to false
      }),
    );

    await act(async () => {
      await result.current.flush();
    });

    expect(save).toHaveBeenCalled();
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it("does NOT write to localStorage when save() throws", async () => {
    const save = vi.fn().mockRejectedValue(new Error("server error"));
    const getValue = vi.fn().mockReturnValue({ version: 1, data: "hello" });

    const { result } = renderHook(() =>
      useAutoSave({
        key: "test-key-123",
        getValue,
        save,
        enabled: true,
        localStorageBackup: true,
      }),
    );

    await act(async () => {
      try { await result.current.flush(); } catch { /* expected */ }
    });

    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });
});
