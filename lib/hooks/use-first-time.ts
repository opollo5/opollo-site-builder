"use client";

import { useCallback, useEffect, useState } from "react";

// Spec 08 — first-time-detection per arbitrary key, backed by localStorage.
// SSR returns `hydrated: false` so the caller waits one render before
// firing celebrate(). Storage shape: localStorage["opollo:first-time:" + key].

const STORAGE_PREFIX = "opollo:first-time:";

export function useFirstTime(key: string): {
  isFirstTime: boolean;
  hydrated: boolean;
  markSeen: () => void;
} {
  const [isFirstTime, setIsFirstTime] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const seen = window.localStorage.getItem(STORAGE_PREFIX + key);
      setIsFirstTime(seen === null);
    } catch {
      // Private mode / quota-full → assume seen so we don't accidentally
      // re-celebrate on every navigation.
      setIsFirstTime(false);
    } finally {
      setHydrated(true);
    }
  }, [key]);

  const markSeen = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, "1");
    } catch {
      // Swallow — at worst we celebrate a second time on this device.
    }
    setIsFirstTime(false);
  }, [key]);

  return { isFirstTime, hydrated, markSeen };
}
