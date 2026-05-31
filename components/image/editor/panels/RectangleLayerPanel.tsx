"use client";

/**
 * RectangleLayerPanel — properties panel for a selected RectangleLayer (U9).
 *
 * Controls: solid color / gradient fill, border-radius, border (color, width, style).
 */

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEditor } from "../EditorContext";
import type { RectangleLayer, Gradient, GradientStop } from "@/lib/image/template-model";
import { VarMetadataPanel } from "./VarMetadataPanel";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1 border-b border-border mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input type="color" value={value ?? "#000000"}
        className="w-7 h-7 rounded border border-border cursor-pointer p-0.5 bg-transparent"
        onChange={(e) => onChange(e.target.value)} />
      <Input value={value ?? ""} placeholder="None" className="h-7 text-xs flex-1"
        onChange={(e) => onChange(e.target.value || null)} />
      {value && <button className="text-xs text-muted-foreground" onClick={() => onChange(null)}>✕</button>}
    </div>
  );
}

const DEFAULT_GRADIENT: Gradient = {
  type: "linear",
  angle: 135,
  stops: [
    { color: "#7C3AED", position: 0 },
    { color: "#DB2777", position: 1 },
  ],
};

export function RectangleLayerPanel({ layer }: { layer: RectangleLayer }) {
  const { dispatch } = useEditor();
  const up = useCallback(
    (patch: Partial<RectangleLayer>) => dispatch({ type: "update_layer", layerId: layer.id, patch }),
    [dispatch, layer.id],
  );

  const isGradient = !!layer.gradient;

  return (
    <div className="px-3 py-2 space-y-1 text-sm">
      <Section title="Fill">
        <div className="flex gap-1 mb-2">
          <Button
            variant={!isGradient ? "default" : "outline"}
            size="sm" className="flex-1 h-7 text-xs"
            onClick={() => up({ color: layer.color ?? "#7C3AED", gradient: null })}
          >
            Solid
          </Button>
          <Button
            variant={isGradient ? "default" : "outline"}
            size="sm" className="flex-1 h-7 text-xs"
            onClick={() => up({ color: null, gradient: layer.gradient ?? DEFAULT_GRADIENT })}
          >
            Gradient
          </Button>
        </div>

        {!isGradient ? (
          <Field label="Color">
            <ColorInput value={layer.color} onChange={(v) => up({ color: v })} />
          </Field>
        ) : (
          <>
            <Field label="Type">
              <div className="flex gap-1">
                {(["linear", "radial"] as const).map((t) => (
                  <Button key={t} size="sm" className="flex-1 h-7 text-xs"
                    variant={layer.gradient?.type === t ? "default" : "outline"}
                    onClick={() => up({ gradient: { ...(layer.gradient ?? DEFAULT_GRADIENT), type: t } })}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </Field>
            {layer.gradient?.type === "linear" && (
              <Field label="Angle">
                <Input type="number" value={layer.gradient.angle ?? 0} min={0} max={360}
                  className="h-7 text-xs"
                  onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) up({ gradient: { ...layer.gradient!, angle: v } }); }} />
              </Field>
            )}
            <div className="text-xs text-muted-foreground mb-1">Stops</div>
            {layer.gradient?.stops.map((stop, i) => (
              <div key={i} className="flex flex-col gap-0.5 mb-2 border-b border-border pb-1">
                <div className="flex items-center gap-1">
                  <input type="color" value={stop.color}
                    className="w-6 h-6 rounded border border-border cursor-pointer p-0.5 bg-transparent"
                    onChange={(e) => {
                      const stops = [...(layer.gradient?.stops ?? [])];
                      stops[i] = { ...stop, color: e.target.value };
                      up({ gradient: { ...layer.gradient!, stops } });
                    }} />
                  <Input type="number" value={Math.round(stop.position * 100)} min={0} max={100}
                    className="h-6 text-xs w-12"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (isNaN(v)) return;
                      const stops = [...(layer.gradient?.stops ?? [])];
                      stops[i] = { ...stop, position: v / 100 };
                      up({ gradient: { ...layer.gradient!, stops } });
                    }} />
                  <span className="text-xs text-muted-foreground">%</span>
                  {/* Opacity for this stop — enables colour-to-transparent fades */}
                  <Input type="number" value={Math.round((stop.opacity ?? 1) * 100)} min={0} max={100}
                    className="h-6 text-xs w-12" title="Opacity %"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (isNaN(v)) return;
                      const stops = [...(layer.gradient?.stops ?? [])];
                      stops[i] = { ...stop, opacity: v / 100 };
                      up({ gradient: { ...layer.gradient!, stops } });
                    }} />
                  <span className="text-xs text-muted-foreground">α</span>
                  {(layer.gradient?.stops.length ?? 0) > 2 && (
                    <button className="text-xs text-muted-foreground ml-auto"
                      onClick={() => {
                        const stops = (layer.gradient?.stops ?? []).filter((_, j) => j !== i);
                        up({ gradient: { ...layer.gradient!, stops } });
                      }}>✕</button>
                  )}
                </div>
              </div>
            ))}
            <button
              className="text-xs text-muted-foreground hover:text-foreground mt-1"
              onClick={() => {
                const stops: GradientStop[] = [...(layer.gradient?.stops ?? []), { color: "#ffffff", position: 1 }];
                up({ gradient: { ...layer.gradient!, stops } });
              }}
            >
              + Add stop
            </button>
          </>
        )}
      </Section>

      <Section title="Shape">
        <Field label="Radius">
          <Input type="number" value={layer.border_radius} min={0} max={500}
            className="h-7 text-xs"
            onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) up({ border_radius: v }); }} />
        </Field>
      </Section>

      <Section title="Border">
        {layer.border ? (
          <>
            <Field label="Color">
              <ColorInput
                value={layer.border.color}
                onChange={(v) => up({ border: v ? { ...layer.border!, color: v } : null })}
              />
            </Field>
            <Field label="Width">
              <Input type="number" value={layer.border.width} min={0} max={40}
                className="h-7 text-xs"
                onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) up({ border: { ...layer.border!, width: v } }); }} />
            </Field>
            <Field label="Style">
              <select value={layer.border.style}
                className="h-7 text-xs w-full border border-input rounded px-2 bg-background"
                onChange={(e) => up({ border: { ...layer.border!, style: e.target.value as "solid" | "dashed" | "dotted" } })}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </Field>
            <button className="text-xs text-muted-foreground mt-1" onClick={() => up({ border: null })}>Remove border</button>
          </>
        ) : (
          <button
            className="text-xs text-muted-foreground hover:text-foreground py-1"
            onClick={() => up({ border: { color: "#000000", width: 1, style: "solid" } })}
          >
            + Add border
          </button>
        )}
      </Section>

      <VarMetadataPanel layer={layer} />
    </div>
  );
}
