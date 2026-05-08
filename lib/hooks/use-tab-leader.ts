"use client";

import { useEffect, useRef, useState } from "react";

// Spec 14 PR B — single-leader election across browser tabs.
//
// Used by useAutoSave to ensure that when an operator has the same page
// open in multiple tabs, only ONE tab actually runs the auto-save
// network call on each cadence tick. Without this, two tabs polling at
// 60s would double the API load on every save and risk version-conflict
// 409s as they race to the version_lock CAS.
//
// Implementation: localStorage-backed heartbeat. The leader writes its
// timestamp every HEARTBEAT_MS (2s). Followers check at the same cadence
// and become leader only if the previous leader's heartbeat is stale by
// more than STALE_MS (5s). This is intentionally simple — BroadcastChannel
// would be more elegant but isn't supported on Safari < 15.4 (still in
// the wild) and the latency tolerance is fine here.
//
// Storage shape: localStorage[`opollo:leader:${key}:lastSeenAt`] = "ms"
//                localStorage[`opollo:leader:${key}:tabId`]      = "uuid"
//
// Each tab generates a UUID on mount and races to claim leadership. When
// the leader's tab closes, its heartbeat goes stale within 5s and a
// follower picks up.

const HEARTBEAT_MS = 2_000;
const STALE_MS = 5_000;

function makeTabId(): string {
  // crypto.randomUUID is available in all modern browsers; fall back to
  // Math.random for ancient ones (still gives sufficient uniqueness for
  // this purpose — collision odds are vanishing for ~5 simultaneous tabs).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export interface UseTabLeaderResult {
  /** True iff this tab currently holds the lease. */
  isLeader: boolean;
  /** Stable id for this tab; useful for tracing. */
  tabId: string;
}

export function useTabLeader(key: string): UseTabLeaderResult {
  const tabIdRef = useRef<string>("");
  if (tabIdRef.current === "") {
    tabIdRef.current = makeTabId();
  }
  const [isLeader, setIsLeader] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const lastSeenKey = `opollo:leader:${key}:lastSeenAt`;
    const tabIdKey = `opollo:leader:${key}:tabId`;
    const myTabId = tabIdRef.current;

    function read(): { lastSeen: number; leaderTabId: string | null } {
      try {
        const lastSeenStr = window.localStorage.getItem(lastSeenKey);
        const leaderTabId = window.localStorage.getItem(tabIdKey);
        const lastSeen = lastSeenStr ? Number.parseInt(lastSeenStr, 10) : 0;
        return {
          lastSeen: Number.isFinite(lastSeen) ? lastSeen : 0,
          leaderTabId,
        };
      } catch {
        return { lastSeen: 0, leaderTabId: null };
      }
    }

    function claim() {
      try {
        window.localStorage.setItem(tabIdKey, myTabId);
        window.localStorage.setItem(lastSeenKey, Date.now().toString());
      } catch {
        // Quota / private mode — fall through; we'll just never be leader.
      }
    }

    function tick() {
      const { lastSeen, leaderTabId } = read();
      const now = Date.now();
      const stale = now - lastSeen > STALE_MS;

      if (leaderTabId === myTabId) {
        // We're leader; refresh the heartbeat.
        claim();
        setIsLeader(true);
        return;
      }

      if (stale || leaderTabId === null) {
        // Vacant or stale → claim leadership.
        claim();
        setIsLeader(true);
        return;
      }

      // Someone else holds it; defer.
      setIsLeader(false);
    }

    // Run immediately so first save can fire without waiting for the
    // first interval tick.
    tick();
    const id = window.setInterval(tick, HEARTBEAT_MS);

    // On tab close, drop the lease so a sibling tab picks it up
    // immediately rather than waiting STALE_MS.
    function onUnload() {
      try {
        const { leaderTabId } = read();
        if (leaderTabId === myTabId) {
          window.localStorage.removeItem(tabIdKey);
          window.localStorage.removeItem(lastSeenKey);
        }
      } catch {
        // best-effort
      }
    }
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("beforeunload", onUnload);
      onUnload();
    };
  }, [key]);

  return { isLeader, tabId: tabIdRef.current };
}
