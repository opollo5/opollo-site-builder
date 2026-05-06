"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// SessionExpiryWarning
//
// Shows a dismissible sonner toast 5 minutes before the admin session JWT
// expires. "Extend session" hits GET /api/auth/ping which lets the Supabase
// middleware refresh the cookie; the response carries the new expires_at so
// the timer resets without a page reload.
//
// Props:
//   expiresAt — Unix epoch seconds from the Supabase session. Pass null when
//               auth is in kill-switch / no-session mode; this component
//               no-ops in that case.
// ---------------------------------------------------------------------------

const WARN_BEFORE_MS = 5 * 60 * 1000; // 5 minutes
const TOAST_ID = "session-expiry-warning";

export function SessionExpiryWarning({
  expiresAt,
}: {
  expiresAt: number | null;
}) {
  const [currentExpiresAt, setCurrentExpiresAt] = useState(expiresAt);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const extend = useCallback(async () => {
    toast.dismiss(TOAST_ID);
    try {
      const res = await fetch("/api/auth/ping");
      if (res.ok) {
        const body = (await res.json()) as { expires_at?: number | null };
        if (body.expires_at) setCurrentExpiresAt(body.expires_at);
      }
    } catch {
      // Fail silently — worst case the session expires naturally.
    }
  }, []);

  useEffect(() => {
    if (!currentExpiresAt) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const expiresMs = currentExpiresAt * 1000;
    const warnAt = expiresMs - WARN_BEFORE_MS;
    const delay = warnAt - Date.now();

    if (delay <= 0) {
      // Already inside the warning window — show immediately.
      toast.warning("Your session is about to expire.", {
        id: TOAST_ID,
        duration: Infinity,
        action: {
          label: "Extend session",
          onClick: extend,
        },
      });
      return;
    }

    timerRef.current = setTimeout(() => {
      toast.warning("Your session will expire in 5 minutes.", {
        id: TOAST_ID,
        duration: Infinity,
        action: {
          label: "Extend session",
          onClick: extend,
        },
      });
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentExpiresAt, extend]);

  return null;
}
