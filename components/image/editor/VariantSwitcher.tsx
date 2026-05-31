"use client";

/**
 * VariantSwitcher — format tabs for the v2 template editor.
 *
 * Multi-format brief: docs/briefs/image-generator/v2-editor/MULTI_FORMAT_BRIEF.md
 *
 * Displays one tab per variant in template.variants plus a "Base" tab.
 * Clicking a tab sets activeVariantKey in EditorContext; the canvas
 * immediately reflows to that variant's dimensions via applyVariant().
 *
 * Platform icons group the formats visually (no separate tab per platform —
 * tabs are per FORMAT, with platform icons grouped on the relevant tab).
 *
 * Layout: tabs sit between the editor header and the three-panel body
 * (centred above the canvas area).
 */

import { SocialPlatformIcon, type SocialPlatformIconKey } from "@/components/ui/SocialPlatformIcon";
import { useEditor } from "./EditorContext";
import type { Variant } from "@/lib/image/template-model";

// ─── Platform groupings per format key ───────────────────────────────────────

const FORMAT_PLATFORMS: Record<string, SocialPlatformIconKey[]> = {
  square:    ["INSTAGRAM", "FACEBOOK", "LINKEDIN"],
  landscape: ["FACEBOOK", "LINKEDIN", "TWITTER"],
};

// ─── Format label + dimensions per key ───────────────────────────────────────

function formatLabel(variant: Variant): string {
  const aspect = `${variant.width}×${variant.height}`;
  const known: Record<string, string> = {
    square: "Square",
    landscape: "Landscape",
  };
  return known[variant.key] ?? variant.key.replace(/_/g, " ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VariantSwitcher() {
  const { state, dispatch, displayTemplate, activeVariant } = useEditor();
  const { template, activeVariantKey } = state;

  // Only render the switcher when the template has at least one variant.
  if (template.variants.length === 0) return null;

  // Suppress the "Base" tab when a named variant already matches the base
  // dimensions — showing both "Base 1080×1080" and "Square 1080×1080" is
  // confusing because they look identical in the editor.
  const baseMatchesVariant = template.variants.some(
    v => v.width === template.width && v.height === template.height,
  );

  const tabs: Array<{ key: string | null; label: string; dims: string; platforms: SocialPlatformIconKey[] }> = [
    // Only show Base tab when no variant covers the base canvas size
    ...(baseMatchesVariant ? [] : [{
      key: null as string | null,
      label: "Base",
      dims: `${template.width}×${template.height}`,
      platforms: [] as SocialPlatformIconKey[],
    }]),
    // One tab per variant
    ...template.variants.map(v => ({
      key: v.key,
      label: formatLabel(v),
      dims: `${v.width}×${v.height}`,
      platforms: FORMAT_PLATFORMS[v.key] ?? [],
    })),
  ];

  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2 border-b border-border bg-muted/20 shrink-0">
      {tabs.map(tab => {
        const isActive = tab.key === activeVariantKey;
        return (
          <button
            key={tab.key ?? "__base__"}
            onClick={() => dispatch({ type: "set_active_variant", variantKey: tab.key })}
            className={[
              "flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-150 border",
              isActive
                ? "bg-background border-border text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/50",
            ].join(" ")}
            title={tab.dims}
          >
            <span>{tab.label}</span>
            <span className={[
              "text-xs tabular-nums hidden sm:inline",
              isActive ? "text-muted-foreground" : "text-muted-foreground/50",
            ].join(" ")}>
              {tab.dims}
            </span>
            {tab.platforms.length > 0 && (
              <span className="flex items-center gap-1 ml-0.5">
                {tab.platforms.map(p => (
                  <SocialPlatformIcon
                    key={p}
                    platform={p}
                    className={[
                      "w-4 h-4 transition-opacity",
                      isActive ? "opacity-60" : "opacity-40",
                    ].join(" ")}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}

      {/* Live canvas dimensions indicator */}
      <span className="ml-2 text-xs text-muted-foreground/50 tabular-nums select-none">
        {displayTemplate.width}×{displayTemplate.height}
      </span>
    </div>
  );
}
