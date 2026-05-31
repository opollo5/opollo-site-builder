"use client";

/**
 * VarMetadataPanel — Variable metadata editor for any layer (§3.7, §9, U11 scope).
 *
 * Drives the N-Series auto-form (Stream B): when a layer has `var` metadata,
 * GET /templates/:id/fields returns it so the social composer can auto-build
 * typed inputs without per-template code.
 *
 * Shared across TextLayerPanel, ImageLayerPanel, and RectangleLayerPanel.
 * The `var` field is optional on LayerBase — this panel creates it on first
 * edit and clears it when the label is emptied.
 */

import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { useEditor } from "../EditorContext";
import type { Layer, VarMetadata, VarCategory } from "@/lib/image/template-model";

const CATEGORIES: { value: VarCategory; label: string }[] = [
  { value: "content",  label: "Content"  },
  { value: "branding", label: "Branding" },
  { value: "media",    label: "Media"    },
  { value: "meta",     label: "Meta"     },
];

interface VarMetadataPanelProps {
  layer: Layer;
}

export function VarMetadataPanel({ layer }: VarMetadataPanelProps) {
  const { dispatch } = useEditor();

  const meta = layer.var;

  const update = useCallback(
    (patch: Partial<VarMetadata>) => {
      const current = layer.var ?? {
        label: "", required: false, default: "", category: "content" as VarCategory, help: "",
      };
      const next = { ...current, ...patch };
      // Clear var entirely if label is empty (makes the field non-modifiable in the API).
      dispatch({
        type: "update_layer",
        layerId: layer.id,
        patch: { var: next.label.trim() ? next : undefined },
      });
    },
    [layer.id, layer.var, dispatch],
  );

  const isEnabled = !!meta?.label.trim();

  return (
    <div className="mb-3">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider pb-1 border-b border-border mb-2">
        Variable (API field)
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        Set a label to expose this layer as a named field in{" "}
        <code className="text-xs font-mono">GET /templates/:id/fields</code>.
        Empty label = not modifiable via the API.
      </p>

      {/* Label */}
      <div className="flex items-center gap-2 py-0.5 mb-1">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Label</span>
        <Input
          value={meta?.label ?? ""}
          placeholder="e.g. Episode Title"
          className="h-7 text-xs flex-1"
          onChange={(e) => update({ label: e.target.value })}
        />
      </div>

      {isEnabled && (
        <>
          {/* Required */}
          <div className="flex items-center gap-2 py-0.5 mb-1">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Required</span>
            <input
              type="checkbox"
              checked={meta?.required ?? false}
              onChange={(e) => update({ required: e.target.checked })}
              className="cursor-pointer"
            />
            <span className="text-xs">Required before generating</span>
          </div>

          {/* Default */}
          <div className="flex items-center gap-2 py-0.5 mb-1">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Default</span>
            <Input
              value={meta?.default ?? ""}
              placeholder="Pre-filled value"
              className="h-7 text-xs flex-1"
              onChange={(e) => update({ default: e.target.value })}
            />
          </div>

          {/* Category */}
          <div className="flex items-center gap-2 py-0.5 mb-1">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Category</span>
            <select
              value={meta?.category ?? "content"}
              className="h-7 text-xs flex-1 border border-input rounded px-2 bg-background"
              onChange={(e) => update({ category: e.target.value as VarCategory })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Help */}
          <div className="flex items-center gap-2 py-0.5">
            <span className="text-xs text-muted-foreground w-16 shrink-0">Help</span>
            <Input
              value={meta?.help ?? ""}
              placeholder='e.g. "Wrap emphasis in *asterisks*"'
              className="h-7 text-xs flex-1"
              onChange={(e) => update({ help: e.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
