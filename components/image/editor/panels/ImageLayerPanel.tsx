"use client";

/**
 * ImageLayerPanel — properties panel for a selected ImageLayer (U8).
 *
 * Controls: source URL / upload, fill mode, anchor X/Y, tint color,
 * border-radius, face-detect toggle (V1: manual focal point note).
 */

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useEditor } from "../EditorContext";
import type { ImageLayer } from "@/lib/image/template-model";
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

function SelectInput<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      className="h-7 text-xs w-full border border-input rounded px-2 bg-background"
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ColorInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="color"
        value={value ?? "#000000"}
        className="w-7 h-7 rounded border border-border cursor-pointer p-0.5 bg-transparent"
        onChange={(e) => onChange(e.target.value)}
      />
      <Input value={value ?? ""} placeholder="None" className="h-7 text-xs flex-1"
        onChange={(e) => onChange(e.target.value || null)} />
      {value && <button className="text-xs text-muted-foreground" onClick={() => onChange(null)}>✕</button>}
    </div>
  );
}

export function ImageLayerPanel({ layer }: { layer: ImageLayer }) {
  const { dispatch } = useEditor();
  const up = useCallback(
    (patch: Partial<ImageLayer>) => dispatch({ type: "update_layer", layerId: layer.id, patch }),
    [dispatch, layer.id],
  );

  return (
    <div className="px-3 py-2 space-y-1 text-sm">
      <Section title="Source">
        <Field label="Image URL">
          <Input
            value={layer.image_url ?? ""}
            placeholder="https://… or leave empty"
            className="h-7 text-xs"
            onChange={(e) => up({ image_url: e.target.value || null })}
          />
        </Field>
        {layer.asset_id && (
          <Field label="Asset ID">
            <span className="text-xs text-muted-foreground font-mono truncate">{layer.asset_id}</span>
          </Field>
        )}
        <Field label="Hide empty">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layer.hide_when_empty}
              onChange={(e) => up({ hide_when_empty: e.target.checked })}
              className="cursor-pointer"
            />
            <span className="text-xs">Hide layer when no image</span>
          </div>
        </Field>
      </Section>

      <Section title="Layout">
        <Field label="Fill">
          <div className="flex gap-1">
            {(["cover", "fit"] as const).map((f) => (
              <Button
                key={f}
                variant={layer.fill === f ? "default" : "outline"}
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => up({ fill: f })}
              >
                {f === "cover" ? "Cover" : "Contain"}
              </Button>
            ))}
          </div>
        </Field>
        <Field label="Anchor X">
          <SelectInput
            value={layer.anchor_x}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
            onChange={(v) => up({ anchor_x: v })}
          />
        </Field>
        <Field label="Anchor Y">
          <SelectInput
            value={layer.anchor_y}
            options={[
              { value: "top", label: "Top" },
              { value: "center", label: "Center" },
              { value: "bottom", label: "Bottom" },
            ]}
            onChange={(v) => up({ anchor_y: v })}
          />
        </Field>
      </Section>

      <Section title="Style">
        <Field label="Tint">
          <ColorInput value={layer.tint_color} onChange={(v) => up({ tint_color: v })} />
        </Field>
        <Field label="Radius">
          <Input
            type="number"
            value={layer.border_radius}
            min={0}
            max={500}
            className="h-7 text-xs"
            onChange={(e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) up({ border_radius: v }); }}
          />
        </Field>
        <Field label="Face detect">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={layer.face_detect}
              onChange={(e) => up({ face_detect: e.target.checked })}
              className="cursor-pointer"
            />
            <span className="text-xs text-muted-foreground">Manual focal point only in V1</span>
          </div>
        </Field>
      </Section>

      <VarMetadataPanel layer={layer} />
    </div>
  );
}
