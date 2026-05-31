"use client";

/**
 * GeometryPanel — geometry block shared by all layer types (U10, §9).
 *
 * Controls (all layers): W, H, X, Y, Angle, Opacity, Skew X/Y.
 * Constraints: horizontal + vertical pin selectors (§8.1 Figma-style).
 * Lock Aspect Ratio: toggle (for image + shape layers).
 *
 * Constraint pins (§8.1):
 *   horizontal: left | right | center | left_right | scale
 *   vertical:   top  | bottom | center | top_bottom  | scale
 *
 * Tier 3 polish: Lucide icons for constraint pins, stacked PairField layout
 * so W/H/X/Y values are fully visible in the narrow two-column grid.
 */

import { useCallback } from "react";
import {
  ChevronLeft, ChevronRight, ArrowLeftRight, Maximize2,
  ChevronUp, ChevronDown, ArrowUpDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "../EditorContext";
import type { Layer, ConstraintHorizontal, ConstraintVertical } from "@/lib/image/template-model";

/** Full-width field with side label — used for single-column controls. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

/**
 * Stacked field — label above input — used in the two-column W/H/X/Y grid.
 * Gives the full column width (~124px) to the number input instead of sharing
 * it with a 64px side label that left only ~52px for values like "1080".
 */
function PairField({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground leading-none opacity-70" title={title}>{label}</span>
      {children}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <Input
      type="number"
      value={Math.round(value * 100) / 100}
      min={min}
      max={max}
      step={step}
      className="h-7 text-xs w-full"
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
    />
  );
}

const H_PIN_OPTIONS: { value: ConstraintHorizontal; icon: React.ElementType; title: string }[] = [
  { value: "left",       icon: ChevronLeft,   title: "Pin left edge" },
  { value: "right",      icon: ChevronRight,  title: "Pin right edge" },
  { value: "center",     icon: ArrowLeftRight, title: "Centre horizontally" },
  { value: "left_right", icon: Maximize2,      title: "Stretch — pin both edges" },
  { value: "scale",      icon: Maximize2,      title: "Scale proportionally with canvas" },
];

const V_PIN_OPTIONS: { value: ConstraintVertical; icon: React.ElementType; title: string }[] = [
  { value: "top",        icon: ChevronUp,     title: "Pin top edge" },
  { value: "bottom",     icon: ChevronDown,   title: "Pin bottom edge" },
  { value: "center",     icon: ArrowUpDown,   title: "Centre vertically" },
  { value: "top_bottom", icon: Maximize2,     title: "Stretch — pin both edges" },
  { value: "scale",      icon: Maximize2,     title: "Scale proportionally with canvas" },
];

export function GeometryPanel({ layer }: { layer: Layer }) {
  const { dispatch } = useEditor();
  const up = useCallback(
    (patch: Partial<Layer>) => dispatch({ type: "update_layer", layerId: layer.id, patch }),
    [dispatch, layer.id],
  );

  const supportsLockAspect = layer.type === "image" || layer.type === "rectangle";

  return (
    <div className="px-3 py-2 border-b border-border">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1 border-b border-border mb-2">
        Geometry
      </div>

      {/* W, H / X, Y / Angle, Opacity / Skew — stacked PairField so the full
          column width is available to the number input (fixes values like "1080"
          being clipped in the old side-label layout). */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 mb-2">
        <PairField label="W" title="Width (px)">
          <NumInput value={layer.width} onChange={(v) => up({ width: Math.max(1, Math.round(v)) })} min={1} />
        </PairField>
        <PairField label="H" title="Height (px)">
          <NumInput value={layer.height} onChange={(v) => up({ height: Math.max(1, Math.round(v)) })} min={1} />
        </PairField>

        <PairField label="X" title="Left position (px)">
          <NumInput value={layer.x} onChange={(v) => up({ x: Math.round(v) })} />
        </PairField>
        <PairField label="Y" title="Top position (px)">
          <NumInput value={layer.y} onChange={(v) => up({ y: Math.round(v) })} />
        </PairField>

        <PairField label="°" title="Rotation (degrees)">
          <NumInput value={layer.rotation} onChange={(v) => up({ rotation: v })} min={-360} max={360} step={0.1} />
        </PairField>
        <PairField label="%" title="Opacity (0–1)">
          <NumInput value={layer.opacity} onChange={(v) => up({ opacity: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.01} />
        </PairField>

        <PairField label="Skew X" title="Horizontal skew (degrees)">
          <NumInput value={layer.skew_x} onChange={(v) => up({ skew_x: v })} min={-89} max={89} step={0.5} />
        </PairField>
        <PairField label="Skew Y" title="Vertical skew (degrees)">
          <NumInput value={layer.skew_y} onChange={(v) => up({ skew_y: v })} min={-89} max={89} step={0.5} />
        </PairField>
      </div>

      {/* Lock aspect ratio (image + rect) */}
      {supportsLockAspect && (
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="lock-ar"
            checked={layer.lock_aspect_ratio}
            onChange={(e) => up({ lock_aspect_ratio: e.target.checked })}
            className="cursor-pointer"
          />
          <label htmlFor="lock-ar" className="text-xs cursor-pointer">Lock aspect ratio</label>
        </div>
      )}

      {/* Constraints — Figma-style pins controlling variant reflow (§8.1) */}
      <div className="mt-1">
        <p className="text-xs text-muted-foreground mb-1">
          Constraints
          <span className="ml-1 text-muted-foreground/60">— how layers reflow when the canvas resizes</span>
        </p>
        <TooltipProvider delayDuration={400}>
          <div className="mb-1">
            <p className="text-xs text-muted-foreground/70 mb-0.5">Horizontal</p>
            <div className="flex gap-1">
              {H_PIN_OPTIONS.map(({ value, icon: Icon, title }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      className={[
                        "flex-1 h-7 flex items-center justify-center rounded border transition-colors",
                        layer.constraints.horizontal === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted",
                      ].join(" ")}
                      onClick={() => up({ constraints: { ...layer.constraints, horizontal: value } })}
                      aria-label={title}
                    >
                      <Icon size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground/70 mb-0.5">Vertical</p>
            <div className="flex gap-1">
              {V_PIN_OPTIONS.map(({ value, icon: Icon, title }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <button
                      className={[
                        "flex-1 h-7 flex items-center justify-center rounded border transition-colors",
                        layer.constraints.vertical === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted",
                      ].join(" ")}
                      onClick={() => up({ constraints: { ...layer.constraints, vertical: value } })}
                      aria-label={title}
                    >
                      <Icon size={13} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        </TooltipProvider>
      </div>
    </div>
  );
}
