"use client";

import { useEffect, useRef, useState } from "react";

// Spec 14 PR B — activity tracker.
//
// Reports whether the operator has been active in the last `windowMs` (default
// 60 seconds). Treats keydown / mousedown / pointerdown / touchstart as
// activity signals. **Mousemove is deliberately NOT included** — passive
// cursor movement (a tooltip hovering over a sidebar, an OS-level mouse
// jump) does not constitute intent and would mask a truly idle session.
//
// Used by the grace-period logic in PR B to decide whether to extend the
// hard-logout deadline past T-0 by up to 15 minutes — but only when the
// operator is genuinely mid-task, not just leaving the browser open on a
// page with idle mousemove.
//
// SSR safe: returns `isActive: false, lastActiveAt: null` until hydration.

const DEFAULT_WINDOW_MS = 60_000;

const ACTIVITY_EVENTS = [
  "keydown",
  "mousedown",
  "pointerdown",
  "touchstart",
] as const;

export interface UseActivityResult {
  /** True if any tracked activity event fired within the window. */
  isActive: boolean;
  /** UNIX ms timestamp of the most recent activity event; null if never seen. */
  lastActiveAt: number | null;
}

export function useActivity(windowMs: number = DEFAULT_WINDOW_MS): UseActivityResult {
  const [lastActiveAt, setLastActiveAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const tickRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function onActivity() {
      setLastActiveAt(Date.now());
    }

    for (const evt of ACTIVITY_EVENTS) {
      // capture:true so listeners on inner elements that stopPropagation
      // don't deprive us of the activity signal. passive:true so we don't
      // block touchstart scroll or keydown editor handlers.
      window.addEventListener(evt, onActivity, { capture: true, passive: true });
    }

    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity, { capture: true });
      }
    };
  }, []);

  // Tick at half the window resolution — enough to flip isActive
  // promptly when the window expires without burning frame budget.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const interval = Math.max(1_000, Math.floor(windowMs / 2));
    function tick() {
      setNow(Date.now());
    }
    tickRef.current = window.setInterval(tick, interval);
    return () => {
      if (tickRef.current !== null) window.clearInterval(tickRef.current);
    };
  }, [windowMs]);

  const isActive = lastActiveAt !== null && now - lastActiveAt < windowMs;
  return { isActive, lastActiveAt };
}
