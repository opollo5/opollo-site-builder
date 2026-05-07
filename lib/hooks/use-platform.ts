"use client";

import { useEffect, useState } from "react";

export type Platform = "mac" | "windows" | "linux" | "unknown";

export function detectPlatform(ua: string, ps: string): Platform {
  const u = ua.toLowerCase();
  const p = (ps || "").toLowerCase();
  if (p.includes("mac") || u.includes("mac os")) return "mac";
  if (p.includes("win") || u.includes("windows")) return "windows";
  if (p.includes("linux") || u.includes("linux")) return "linux";
  return "unknown";
}

export function usePlatform(): { platform: Platform; hydrated: boolean } {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined") {
      setHydrated(true);
      return;
    }
    setPlatform(detectPlatform(navigator.userAgent, navigator.platform || ""));
    setHydrated(true);
  }, []);

  return { platform, hydrated };
}

// String-form modifier label, suited for HTML `title` attributes (which
// don't accept JSX). Returns "Ctrl" until hydration completes — same
// flash-prevention principle as <Kbd>. After hydration: "⌘" on macOS,
// "Ctrl" everywhere else.
export function useModKey(): string {
  const { platform, hydrated } = usePlatform();
  return hydrated && platform === "mac" ? "⌘" : "Ctrl";
}
