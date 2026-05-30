"use client";

/**
 * EditorLeftPanel — left panel of the v2 template editor (U4).
 *
 * Layer list: top-first (index 0 = visual top). Drag-to-reorder via HTML5
 * drag-and-drop (dispatches reorder_layers on drop). Each row: LayerRow
 * with type icon, editable name, lock/hide indicators, context menu.
 * New Layer (+) button at the bottom (opens AddLayerMenu from U14 — placeholder for now).
 */

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useEditor } from "./EditorContext";
import { LayerRow } from "./LayerRow";

export function EditorLeftPanel() {
  const { state, dispatch } = useEditor();
  const { template, selectedLayerId } = state;

  const dragFromIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  return (
    <aside className="w-[280px] border-r border-border flex flex-col overflow-hidden bg-background shrink-0">
      {/* Canvas info */}
      <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-between">
        <span className="font-medium text-foreground truncate">{template.name}</span>
        <span className="shrink-0">{template.width} × {template.height}</span>
      </div>

      {/* Layers header */}
      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
        Layers
      </div>

      {/* Layer list (top-first, drag-to-reorder) */}
      <div
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          const from = dragFromIndex.current;
          const to = dragOverIndex;
          setDragOverIndex(null);
          dragFromIndex.current = null;
          if (from !== null && to !== null && from !== to) {
            dispatch({ type: "reorder_layers", fromIndex: from, toIndex: to });
          }
        }}
      >
        {template.layers.map((layer, idx) => (
          <div
            key={layer.id}
            onDragOver={(e) => { e.preventDefault(); setDragOverIndex(idx); }}
            className={dragOverIndex === idx ? "bg-blue-500/10 border-t-2 border-blue-500" : ""}
          >
            <LayerRow
              layer={layer}
              index={idx}
              isSelected={layer.id === selectedLayerId}
              dragHandleProps={{
                draggable: true,
                onDragStart: () => { dragFromIndex.current = idx; },
                onDragEnd: () => { dragFromIndex.current = null; setDragOverIndex(null); },
              }}
            />
          </div>
        ))}

        {template.layers.length === 0 && (
          <p className="px-3 py-6 text-xs text-muted-foreground text-center">
            No layers yet.<br />Click + to add one.
          </p>
        )}
      </div>

      {/* Footer: layer count + new layer button */}
      <div className="px-3 py-2 border-t border-border flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {template.layers.length} layer{template.layers.length !== 1 ? "s" : ""}
        </span>
        {/* New Layer menu — wired in U14 */}
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2" title="Add layer (U14)">
          + Layer
        </Button>
      </div>
    </aside>
  );
}
