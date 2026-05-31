"use client";

/**
 * EditorLeftPanel — left panel of the v2 template editor (U4 + Tier 2 UAT).
 *
 * Layer list: top-first (index 0 = visual top). Drag-to-reorder via HTML5
 * drag-and-drop (dispatches reorder_layers on drop). Each row: LayerRow
 * with type icon, editable name, lock/hide indicators, context menu.
 * AddLayerMenu: + Layer button opens type picker (text/image/rectangle).
 * Guides toggle: snaps on/off, persists in template.settings.guides.
 */

import { useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "./EditorContext";
import { LayerRow } from "./LayerRow";
import { AddLayerMenu } from "./AddLayerMenu";

export function EditorLeftPanel() {
  const { state, dispatch } = useEditor();
  const { template, selectedLayerId } = state;

  const dragFromIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const guidesEnabled = template.settings?.guides !== false;

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
      <ScrollArea
        className="flex-1"
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
            className={dragOverIndex === idx ? "bg-accent/10 border-t-2 border-accent" : ""}
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
      </ScrollArea>

      {/* Footer: guides toggle + layer count + add-layer menu */}
      <div className="px-3 py-2 border-t border-border space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {template.layers.length} layer{template.layers.length !== 1 ? "s" : ""}
          </span>
          <AddLayerMenu />
        </div>
        <button
          className={[
            "flex items-center gap-1.5 text-xs w-full transition-colors",
            guidesEnabled ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground",
          ].join(" ")}
          onClick={() => dispatch({ type: "toggle_guides" })}
          title={guidesEnabled ? "Snap guides on — click to disable" : "Snap guides off — click to enable"}
        >
          <span>{guidesEnabled ? "⊞" : "⊡"}</span>
          <span>Snap guides {guidesEnabled ? "on" : "off"}</span>
        </button>
      </div>
    </aside>
  );
}
