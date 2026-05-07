"use client";

import confetti from "canvas-confetti";

// Spec 08 — production-tested heuristic: subtle confetti only.
// medium / big intensities are NOT used by default per the brief — restraint
// reads better than expressiveness on a B2B agency tool. Always respects
// prefers-reduced-motion. SSR safe.

const BRAND_COLORS = ["#00e5a0", "#FF03A5", "#FFFFFF"];

export function celebrate(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  } catch {
    // matchMedia missing in some legacy browsers — proceed.
  }
  confetti({
    particleCount: 30,
    spread: 40,
    startVelocity: 25,
    origin: { y: 0.4 },
    colors: BRAND_COLORS,
    ticks: 150,
  });
}
