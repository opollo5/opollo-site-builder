"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// RS-4 — generic polling hook.
//
// Polls `url` every `intervalMs` (default 4000) and exposes the latest
// snapshot. Pauses while the tab is hidden (visibilitychange listener)
// and triggers an immediate fetch when the tab becomes visible again.
//
// Contract:
//   - `data`        latest successful payload, or `null` before first
//                   fetch lands.
//   - `error`       Error from the most recent failed fetch; cleared on
//                   the next success. Polling continues on error so a
//                   transient network blip doesn't park the UI.
//   - `isStale`     `true` once `lastFetchAt + intervalMs * 2` has
//                   elapsed without a successful fetch. Drives the
//                   "reconnecting…" indicator.
//   - `isFetching`  in-flight indicator for the current cycle.
//   - `refresh`     manual trigger; mutations call it after a successful
//                   POST so the UI updates without waiting for the next
//                   tick.
//
// Single in-flight fetch per hook instance — late responses from
// previous ticks are aborted on a new tick to prevent out-of-order
// updates.
//
// Pass `null` for `url` to disable polling without unmounting the hook
// (useful when the brief isn't committed yet).
// ---------------------------------------------------------------------------

export interface UsePollOptions {
  intervalMs?: number;
  enabled?: boolean;
}

export interface UsePollResult<T> {
  data: T | null;
  error: Error | null;
  isStale: boolean;
  isFetching: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 4000;

export function usePoll<T>(
  url: string | null,
  options: UsePollOptions = {},
): UsePollResult<T> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const enabled = options.enabled ?? true;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isStale, setIsStale] = useState(false);

  // Refs avoid re-creating doFetch on every state change (which would
  // restart the interval).
  const urlRef = useRef(url);
  urlRef.current = url;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const inFlightRef = useRef<AbortController | null>(null);
  const lastFetchAtRef = useRef<number>(0);

  const doFetch = useCallback(async (): Promise<void> => {
    const currentUrl = urlRef.current;
    if (!currentUrl || !enabledRef.current) return;

    if (inFlightRef.current) inFlightRef.current.abort();
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    setIsFetching(true);
    try {
      const res = await fetch(currentUrl, {
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      if (ctrl.signal.aborted) return;
      setData(json);
      setError(null);
      setIsStale(false);
      lastFetchAtRef.current = Date.now();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
    } finally {
      if (!ctrl.signal.aborted) setIsFetching(false);
    }
  }, []);

  // Interval polling + visibility-aware pause.
  useEffect(() => {
    if (!url || !enabled) return;

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (cancelled) return;
      timerId = setTimeout(async () => {
        if (cancelled) return;
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          // Tab hidden → skip this tick but keep the loop alive so the
          // moment the tab returns we resume on the next interval.
          schedule();
          return;
        }
        await doFetch();
        schedule();
      }, intervalMs);
    }

    function onVisibility() {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        // Immediate refresh on tab return so the operator doesn't wait
        // up to `intervalMs` for the first update.
        void doFetch();
      }
    }

    // Initial fetch then schedule.
    void doFetch();
    schedule();

    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onVisibility);
      if (inFlightRef.current) inFlightRef.current.abort();
    };
    // doFetch is stable (empty deps); intervalMs / url / enabled changes
    // do reset the loop intentionally.
  }, [url, enabled, intervalMs, doFetch]);

  // Stale detection — runs a cheap timer that flips `isStale` once the
  // last successful fetch is more than 2 * intervalMs in the past.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (lastFetchAtRef.current === 0) return;
      const stale = Date.now() - lastFetchAtRef.current > intervalMs * 2;
      setIsStale((current) => (current === stale ? current : stale));
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  return { data, error, isStale, isFetching, refresh: doFetch };
}
