"use client";

/**
 * GeometryPanel — geometry block shared by all layer types (U10, §9).
 *
 * Controls (all layers): W, H, X, Y, Angle, Opacity.
 * Constraints: horizontal + vertical pin selectors (§8.1 Figma-style).
 * Lock Aspect Ratio: toggle (for image + shape layers).
 *
 * Constraint pins (§8.1):
 *   horizontal: left | right | center | left_right | scale
 *   vertical:   top  | bottom | center | top_bottom  | scale
 */

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { useEditor } from "../EditorContext";
import type { Layer, ConstraintHorizontal, ConstraintVertical } from "@/lib/image/template-model";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
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
      className="h-7 text-xs"
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v)) onChange(v);
      }}
    />
  );
}

const H_PIN_OPTIONS: { value: ConstraintHorizontal; label: string; title: string }[] = [
  { value: "left",       label: "←",   title: "Pin left edge" },
  { value: "right",      label: "→",   title: "Pin right edge" },
  { value: "center",     label: "↔",   title: "Center horizontally" },
  { value: "left_right", label: "⇔",   title: "Stretch (pin both edges)" },
  { value: "scale",      label: "⟺",  title: "Scale with canvas" },
];

const V_PIN_OPTIONS: { value: ConstraintVertical; label: string; title: string }[] = [
  { value: "top",        label: "↑",   title: "Pin top edge" },
  { value: "bottom",     label: "↓",   title: "Pin bottom edge" },
  { value: "center",     label: "↕",   title: "Center vertically" },
  { value: "top_bottom", label: "⇕",   title: "Stretch (pin both edges)" },
  { value: "scale",      label: "⟺",  title: "Scale with canvas" },
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

      {/* W, H */}
      <div className="flex gap-1 mb-1">
        <div className="flex-1">
          <Field label="W">
            <NumInput value={layer.width} onChange={(v) => up({ width: Math.max(1, Math.round(v)) })} min={1} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="H">
            <NumInput value={layer.height} onChange={(v) => up({ height: Math.max(1, Math.round(v)) })} min={1} />
          </Field>
        </div>
      </div>

      {/* X, Y */}
      <div className="flex gap-1 mb-1">
        <div className="flex-1">
          <Field label="X">
            <NumInput value={layer.x} onChange={(v) => up({ x: Math.round(v) })} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Y">
            <NumInput value={layer.y} onChange={(v) => up({ y: Math.round(v) })} />
          </Field>
        </div>
      </div>

      {/* Angle, Opacity */}
      <div className="flex gap-1 mb-1">
        <div className="flex-1">
          <Field label="Angle">
            <NumInput value={layer.rotation} onChange={(v) => up({ rotation: v })} min={-360} max={360} step={0.1} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Opacity">
            <NumInput value={layer.opacity} onChange={(v) => up({ opacity: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.01} />
          </Field>
        </div>
      </div>

      {/* Skew X, Skew Y (§6.1, §1.3 — all layer types) */}
      <div className="flex gap-1 mb-2">
        <div className="flex-1">
          <Field label="Skew X">
            <NumInput value={layer.skew_x} onChange={(v) => up({ skew_x: v })} min={-89} max={89} step={0.5} />
          </Field>
        </div>
        <div className="flex-1">
          <Field label="Skew Y">
            <NumInput value={layer.skew_y} onChange={(v) => up({ skew_y: v })} min={-89} max={89} step={0.5} />
          </Field>
        </div>
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

      {/* Constraints */}
      <div className="mt-1">
        <p className="text-xs text-muted-foreground mb-1">Constraints (Figma-style pins for variant reflow)</p>
        <div className="mb-1">
          <p className="text-xs text-muted-foreground mb-0.5">Horizontal</p>
          <div className="flex gap-1">
            {H_PIN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                title={opt.title}
                className={[
                  "flex-1 h-7 text-xs rounded border transition-colors",
                  layer.constraints.horizontal === opt.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted",
                ].join(" ")}
                onClick={() => up({ constraints: { ...layer.constraints, horizontal: opt.value } })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Vertical</p>
          <div className="flex gap-1">
            {V_PIN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                title={opt.title}
                className={[
                  "flex-1 h-7 text-xs rounded border transition-colors",
                  layer.constraints.vertical === opt.value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-muted",
                ].join(" ")}
                onClick={() => up({ constraints: { ...layer.constraints, vertical: opt.value } })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
