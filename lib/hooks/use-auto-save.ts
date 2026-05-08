"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSessionGrace } from "@/lib/hooks/use-session-grace";
import { useTabLeader } from "@/lib/hooks/use-tab-leader";

// Spec 14 PR B — auto-save with three load-bearing safeguards.
//
//   1. Dirty-state guard. A save fires only when the value has changed
//      since the last successful save. Without this, multiple tabs hit
//      the API on every cadence tick regardless of whether anything
//      changed — a recipe for spurious version-conflict 409s and load.
//
//   2. Cross-tab leader election. Followers skip auto-save entirely;
//      only the leader writes. Pairs with useTabLeader's localStorage
//      heartbeat (2s tick, 5s staleness threshold). Sibling tabs still
//      mark dirty so on leader-handoff the new leader picks up the
//      pending save.
//
//   3. Visibility-aware cadence with state-driven escalation. Cadence
//      escalates as the session approaches expiry: 60s normal → 30s
//      while the warning modal is up → 15s during grace. Background
//      tabs (document.hidden) save at half rate so a backgrounded tab
//      doesn't spam the API just because it's still loaded.
//
// Caller contract:
//   - getValue() must be cheap (it runs on every cadence tick); return
//     the smallest serialisable representation of the editor state.
//   - serialize(value) returns the JSON-stringifiable thing equality
//     compares against. The default is JSON.stringify; override only
//     if your value needs canonicalisation (e.g. sorted keys).
//   - save(value) returns a promise. Errors are surfaced via onError
//     and DO NOT mark the value clean — the next tick will retry.
//
// The hook does NOT throttle the underlying network call. If you need
// optimistic concurrency, layer version_lock CAS in your save() body
// and translate 409s into a "stale draft" UI surface.

export type AutoSaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "follower";

export interface UseAutoSaveOptions<T> {
  /** Stable identifier — drives leader-election key + telemetry. */
  key: string;
  /** Cheap snapshot of the editor state. Runs on every cadence tick. */
  getValue: () => T;
  /** Persist the snapshot. Reject to surface as `error` and retry. */
  save: (value: T) => Promise<void>;
  /** Custom equality. Defaults to JSON.stringify-equal. */
  serialize?: (value: T) => string;
  /** Hook called once a save resolves. Useful for "Saved Ns ago". */
  onSuccess?: (value: T) => void;
  /** Hook called when save() throws. Surface the error in UI. */
  onError?: (err: Error) => void;
  /** When false, the hook is fully inert. Use for read-only views. */
  enabled?: boolean;
}

const NORMAL_CADENCE_MS = 60_000;
const WARNING_CADENCE_MS = 30_000;
const GRACE_CADENCE_MS = 15_000;
// Background-tab cadence multiplier — half rate matches the spec.
const HIDDEN_CADENCE_MULTIPLIER = 2;

export function useAutoSave<T>(opts: UseAutoSaveOptions<T>): {
  status: AutoSaveStatus;
  lastSavedAt: number | null;
  error: Error | null;
  /** Manually flush a save right now (still respects dirty + leader gates). */
  flush: () => Promise<void>;
} {
  const { key, getValue, save, serialize, onSuccess, onError, enabled = true } = opts;

  const grace = useSessionGrace();
  const { isLeader } = useTabLeader(`autosave:${key}`);

  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Track the last serialized value we know is persisted. Comparing to
  // this drives the dirty-state guard.
  const lastSavedSerializedRef = useRef<string | null>(null);
  // Hold-off ref so a save in flight isn't double-fired by a tick.
  const inFlightRef = useRef(false);

  const ser = useMemo(
    () => serialize ?? ((v: T) => JSON.stringify(v)),
    [serialize],
  );

  const tryFlush = useCallback(async () => {
    if (!enabled) return;
    if (inFlightRef.current) return;
    if (!isLeader) {
      setStatus("follower");
      return;
    }
    const value = getValue();
    const serialized = ser(value);
    if (serialized === lastSavedSerializedRef.current) {
      // Clean: nothing to save.
      return;
    }
    inFlightRef.current = true;
    setStatus("saving");
    try {
      await save(value);
      // Capture the serialized form AT save-issue time. If the user
      // mutated state during the in-flight call, the next tick's
      // serialized form will differ → next save fires. Correct.
      lastSavedSerializedRef.current = serialized;
      setLastSavedAt(Date.now());
      setStatus("saved");
      setError(null);
      onSuccess?.(value);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setStatus("error");
      onError?.(e);
      // Note: we deliberately do NOT update lastSavedSerializedRef on
      // failure — the next tick will retry the same value.
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, isLeader, getValue, ser, save, onSuccess, onError]);

  // Mark dirty on any value change so the UI's status pill flips even
  // before the next tick.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const interval = (() => {
      let base = NORMAL_CADENCE_MS;
      if (grace.status === "grace") base = GRACE_CADENCE_MS;
      else if (
        grace.minutesRemaining !== null &&
        grace.minutesRemaining <= 120
      ) {
        base = WARNING_CADENCE_MS;
      }
      const hidden = typeof document !== "undefined" && document.hidden;
      return hidden ? base * HIDDEN_CADENCE_MULTIPLIER : base;
    })();

    // Leader checks dirty; follower flips to follower status without firing.
    function tick() {
      if (!enabled) return;
      if (!isLeader) {
        setStatus((prev) => (prev === "follower" ? prev : "follower"));
        return;
      }
      // Cheap dirty check on the way in so the status pill is accurate
      // even when a save is throttled.
      try {
        const cur = ser(getValue());
        if (cur !== lastSavedSerializedRef.current && status !== "saving") {
          setStatus((prev) => (prev === "saving" ? prev : "dirty"));
        }
      } catch {
        // Don't mask the user's editor on a serializer throw.
      }
      void tryFlush();
    }

    tick();
    const id = window.setInterval(tick, interval);

    // Re-tick when visibility flips so a focused tab catches up
    // immediately rather than waiting for the next interval.
    function onVis() {
      tick();
    }
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
    // intentionally narrow deps — re-running this effect on every status
    // change would reset the interval cadence on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isLeader, grace.status, grace.minutesRemaining, tryFlush]);

  return {
    status,
    lastSavedAt,
    error,
    flush: tryFlush,
  };
}
