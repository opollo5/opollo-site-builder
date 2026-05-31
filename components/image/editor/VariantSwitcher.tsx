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

  const tabs: Array<{ key: string | null; label: string; dims: string; platforms: SocialPlatformIconKey[] }> = [
    // Base tab (the template's own dimensions)
    {
      key: null,
      label: "Base",
      dims: `${template.width}×${template.height}`,
      platforms: [],
    },
    // One tab per variant
    ...template.variants.map(v => ({
      key: v.key,
      label: formatLabel(v),
      dims: `${v.width}×${v.height}`,
      platforms: FORMAT_PLATFORMS[v.key] ?? [],
    })),
  ];

  return (
    <div className="flex items-center justify-center gap-1 px-3 py-1.5 border-b border-border bg-muted/30 shrink-0">
      {tabs.map(tab => {
        const isActive = tab.key === activeVariantKey;
        return (
          <button
            key={tab.key ?? "__base__"}
            onClick={() => dispatch({ type: "set_active_variant", variantKey: tab.key })}
            className={[
              "flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-colors border",
              isActive
                ? "bg-background border-border text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-background/60",
            ].join(" ")}
            title={tab.dims}
          >
            <span className="font-medium">{tab.label}</span>
            <span className="text-muted-foreground/60 text-[10px] leading-none hidden sm:inline">
              {tab.dims}
            </span>
            {tab.platforms.length > 0 && (
              <span className="flex items-center gap-0.5 ml-0.5">
                {tab.platforms.map(p => (
                  <SocialPlatformIcon
                    key={p}
                    platform={p}
                    className="w-3 h-3 text-muted-foreground/60"
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
