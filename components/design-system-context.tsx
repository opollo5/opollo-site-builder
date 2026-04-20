"use client";

import { createContext, useContext } from "react";
import type { DesignSystem } from "@/lib/design-systems";

// Context provided by app/admin/sites/[id]/design-system/layout.tsx.
//
// Children pages (Versions / Components / Templates / Preview) pull the
// site + all versions from here so each page doesn't re-fetch the same data.
// Selection of the "currently viewed" DS is a per-page concern, not a
// context concern — pages read the `?ds=<uuid>` query param themselves and
// look up from `versions`.

export type DesignSystemSiteSummary = {
  id: string;
  name: string;
  prefix: string;
};

export type DesignSystemLayoutContextValue = {
  site: DesignSystemSiteSummary;
  versions: DesignSystem[];
  refetch: () => void;
};

export const DesignSystemLayoutContext =
  createContext<DesignSystemLayoutContextValue | null>(null);

export function useDesignSystemLayout(): DesignSystemLayoutContextValue {
  const ctx = useContext(DesignSystemLayoutContext);
  if (ctx === null) {
    throw new Error(
      "useDesignSystemLayout must be used within DesignSystemLayoutContext.Provider — " +
        "make sure the component is rendered under app/admin/sites/[id]/design-system/layout.tsx.",
    );
  }
  return ctx;
}

// Helper: resolve the DS a page is "viewing" from the URL's ?ds param +
// the versions list. Priority:
//   1. ?ds=<uuid> if valid (exists in versions)
//   2. the active version for the site
//   3. the newest version (highest version number)
//   4. null when the site has no versions at all
export function resolveSelectedDesignSystem(
  versions: DesignSystem[],
  dsParam: string | null,
): DesignSystem | null {
  if (dsParam) {
    const match = versions.find((v) => v.id === dsParam);
    if (match) return match;
  }
  const active = versions.find((v) => v.status === "active");
  if (active) return active;
  if (versions.length === 0) return null;
  return [...versions].sort((a, b) => b.version - a.version)[0];
}
