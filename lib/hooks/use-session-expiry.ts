"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useRef, useState } from "react";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Spec 14 PR A — session-expiry tracker.
//
// Reads the active Supabase session's `expires_at` (UNIX seconds) and
// derives `minutesRemaining`. Re-evaluates every 30 seconds (the spec's
// resolution doesn't need second-precision; we just need to fire the
// modal at T-120m and the banner at T-5m without keeping a tight wake-
// up loop running).
//
// The hook does NOT logout — it returns `expired: true` and lets the
// caller decide. Hard-logout enforcement happens in PR B alongside the
// activity / grace logic.
//
// Caveats:
//   • Returns `null` when no session is loaded (logged-out, or initial
//     mount). Callers must handle that.
//   • Mirrors the JWT_EXPIRY set in the Supabase dashboard. If the
//     dashboard is set to <48h, the warning thresholds simply fire
//     proportionally earlier; nothing in this hook hardcodes 48h.

export interface SessionExpiry {
  /** UNIX seconds. */
  expiresAt: number | null;
  /** Whole minutes remaining; clamped to >= 0. */
  minutesRemaining: number | null;
  /** True once expiresAt has passed. */
  expired: boolean;
  /** True after the first session read returns (avoids flashing modals on first paint). */
  hydrated: boolean;
}

const POLL_INTERVAL_MS = 30_000;

export function useSessionExpiry(): SessionExpiry {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [hydrated, setHydrated] = useState(false);
  const tickRef = useRef<number | null>(null);

  // Load the session once; subsequent reads come via Supabase's onAuthStateChange.
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    const supa = createBrowserClient(supabaseUrl, supabaseAnonKey);
    void supa.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const at = data.session?.expires_at ?? null;
      setExpiresAt(at);
      setHydrated(true);
    });
    const { data: sub } = supa.auth.onAuthStateChange((_event, session) => {
      setExpiresAt(session?.expires_at ?? null);
      setHydrated(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Tick every POLL_INTERVAL_MS so minutesRemaining stays fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function tick() {
      setNow(Math.floor(Date.now() / 1000));
    }
    tick();
    tickRef.current = window.setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, []);

  if (expiresAt === null) {
    return { expiresAt: null, minutesRemaining: null, expired: false, hydrated };
  }
  const secondsRemaining = Math.max(0, expiresAt - now);
  const minutesRemaining = Math.floor(secondsRemaining / 60);
  return {
    expiresAt,
    minutesRemaining,
    expired: secondsRemaining === 0,
    hydrated,
  };
}
