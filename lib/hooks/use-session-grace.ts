"use client";

import { useEffect, useRef, useState } from "react";

import { useActivity } from "@/lib/hooks/use-activity";
import { useSessionExpiry } from "@/lib/hooks/use-session-expiry";

// Spec 14 PR B — non-renewable activity grace window.
//
// Wraps useSessionExpiry + useActivity. At T-0 (the moment the JWT
// `expires_at` lapses), if the operator is active in the trailing
// 60-second window, we enter a fixed 15-minute grace state. The grace
// timer is **non-renewable**: typing during grace does NOT reset it.
// At graceStartedAt + 15min the hook reports `mustLogout: true` and the
// caller is expected to invalidate the session and redirect.
//
// If the operator is INACTIVE at T-0, no grace is offered — `mustLogout`
// flips to true immediately. This is the security property: leaving a
// browser tab open does not extend the session past 48h.
//
// Resolution: useSessionExpiry polls at 30s; the grace transition can
// therefore lag T-0 by up to 30s. Acceptable per spec — the grace itself
// runs on a tight timer once entered.
//
// State machine:
//   • !expired                          → status: 'active'
//   • expired && !wasActiveAtExpiry     → status: 'logout-now', mustLogout: true
//   • expired && wasActiveAtExpiry &&
//       Date.now() < graceEndsAt        → status: 'grace', graceMinutesRemaining > 0
//   • expired && wasActiveAtExpiry &&
//       Date.now() >= graceEndsAt       → status: 'logout-now', mustLogout: true

const GRACE_DURATION_MS = 15 * 60 * 1000;

export type SessionGraceStatus = "active" | "grace" | "logout-now";

export interface UseSessionGraceResult {
  status: SessionGraceStatus;
  /** Same as useSessionExpiry — pass-through so callers don't double-wire. */
  minutesRemaining: number | null;
  hydrated: boolean;
  /** During grace: minutes remaining until forced logout. Null otherwise. */
  graceMinutesRemaining: number | null;
  /** Caller must terminate the session + redirect. */
  mustLogout: boolean;
}

export function useSessionGrace(): UseSessionGraceResult {
  const expiry = useSessionExpiry();
  const { isActive } = useActivity();

  // graceStartedAt is captured the moment we enter grace and never moves
  // again until the session refreshes (which clears the ref).
  const graceStartedAtRef = useRef<number | null>(null);
  const [, forceTick] = useState(0);

  // Reset grace state on session refresh — `expired` flipping back to false
  // means re-auth happened and we're back to a fresh 48h window.
  useEffect(() => {
    if (!expiry.expired) {
      graceStartedAtRef.current = null;
    }
  }, [expiry.expired]);

  // Capture the grace-start moment.
  useEffect(() => {
    if (
      expiry.expired &&
      isActive &&
      graceStartedAtRef.current === null
    ) {
      graceStartedAtRef.current = Date.now();
    }
  }, [expiry.expired, isActive]);

  // Tight tick during grace so `graceMinutesRemaining` updates and
  // `mustLogout` flips at the right moment without waiting on the
  // useSessionExpiry's 30s cadence.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!expiry.expired) return;
    const id = window.setInterval(() => forceTick((n) => n + 1), 1_000);
    return () => window.clearInterval(id);
  }, [expiry.expired]);

  if (!expiry.hydrated || !expiry.expired) {
    return {
      status: "active",
      minutesRemaining: expiry.minutesRemaining,
      hydrated: expiry.hydrated,
      graceMinutesRemaining: null,
      mustLogout: false,
    };
  }

  // Expired. Did we capture grace start?
  if (graceStartedAtRef.current === null) {
    // Session expired and no activity at the moment of expiry → logout now.
    return {
      status: "logout-now",
      minutesRemaining: 0,
      hydrated: expiry.hydrated,
      graceMinutesRemaining: null,
      mustLogout: true,
    };
  }

  const graceEndsAt = graceStartedAtRef.current + GRACE_DURATION_MS;
  const msRemaining = graceEndsAt - Date.now();
  if (msRemaining <= 0) {
    return {
      status: "logout-now",
      minutesRemaining: 0,
      hydrated: expiry.hydrated,
      graceMinutesRemaining: 0,
      mustLogout: true,
    };
  }

  return {
    status: "grace",
    minutesRemaining: 0,
    hydrated: expiry.hydrated,
    graceMinutesRemaining: Math.ceil(msRemaining / 60_000),
    mustLogout: false,
  };
}
