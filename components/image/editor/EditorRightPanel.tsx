"use client";

/**
 * EditorRightPanel — right properties panel of the v2 template editor.
 *
 * Dispatches to per-type panels (§9):
 *   TextLayer  → TextLayerPanel   (U5/U6/U7) + GeometryPanel (U10)
 *   ImageLayer → ImageLayerPanel  (U8)        + GeometryPanel (U10)
 *   Rectangle  → RectanglePanel   (U9)        + GeometryPanel (U10)
 *
 * U8, U9, U10 panels are stubs — wired fully in their respective slices.
 */

import { useEditor } from "./EditorContext";
import { TextLayerPanel } from "./panels/TextLayerPanel";
import type { TextLayer } from "@/lib/image/template-model";

export function EditorRightPanel() {
  const { selectedLayer } = useEditor();

  return (
    <aside className="w-[280px] border-l border-border flex flex-col overflow-hidden bg-background shrink-0">
      {selectedLayer ? (
        <>
          {/* Panel header */}
          <div className="px-3 py-2 border-b border-border text-xs flex items-center justify-between shrink-0">
            <span className="font-medium text-foreground truncate">{selectedLayer.name}</span>
            <span className="capitalize text-muted-foreground">{selectedLayer.type}</span>
          </div>

          {/* Scrollable properties */}
          <div className="flex-1 overflow-y-auto">
            {selectedLayer.type === "text" && (
              <TextLayerPanel layer={selectedLayer as TextLayer} />
            )}
            {selectedLayer.type === "image" && (
              <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                Image properties (U8)
              </div>
            )}
            {selectedLayer.type === "rectangle" && (
              <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                Rectangle properties (U9)
              </div>
            )}
            {selectedLayer.type !== "text" && selectedLayer.type !== "image" && selectedLayer.type !== "rectangle" && (
              <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                Reserved layer type — not editable in V1
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground text-center px-4">
            Select a layer to edit its properties
          </p>
        </div>
      )}
    </aside>
  );
}
