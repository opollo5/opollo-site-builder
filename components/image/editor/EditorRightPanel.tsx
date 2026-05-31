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

import { ScrollArea } from "@/components/ui/scroll-area";
import { useEditor } from "./EditorContext";
import { TextLayerPanel } from "./panels/TextLayerPanel";
import { ImageLayerPanel } from "./panels/ImageLayerPanel";
import { RectangleLayerPanel } from "./panels/RectangleLayerPanel";
import { ShapeLayerPanel } from "./panels/ShapeLayerPanel";
import { GeometryPanel } from "./panels/GeometryPanel";
import type { TextLayer, ImageLayer, RectangleLayer, ShapeLayer } from "@/lib/image/template-model";

export function EditorRightPanel() {
  const { selectedLayer } = useEditor();

  return (
    <aside className="w-[320px] border-l border-border flex flex-col overflow-hidden bg-background shrink-0">
      {selectedLayer ? (
        <>
          {/* Panel header */}
          <div className="px-3 py-2 border-b border-border text-xs flex items-center justify-between shrink-0">
            <span className="font-medium text-foreground truncate">{selectedLayer.name}</span>
            <span className="capitalize text-muted-foreground">{selectedLayer.type}</span>
          </div>

          {/* Scrollable properties — ScrollArea gives a styled thin scrollbar */}
          <ScrollArea className="flex-1">
            {/* Geometry block — shown for all layer types (U10) */}
            <GeometryPanel layer={selectedLayer} />

            {selectedLayer.type === "text" && (
              <TextLayerPanel layer={selectedLayer as TextLayer} />
            )}
            {selectedLayer.type === "image" && (
              <ImageLayerPanel layer={selectedLayer as ImageLayer} />
            )}
            {selectedLayer.type === "rectangle" && (
              <RectangleLayerPanel layer={selectedLayer as RectangleLayer} />
            )}
            {selectedLayer.type === "shape" && (
              <ShapeLayerPanel layer={selectedLayer as ShapeLayer} />
            )}
            {selectedLayer.type !== "text" && selectedLayer.type !== "image" && selectedLayer.type !== "rectangle" && selectedLayer.type !== "shape" && (
              <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                This layer type is reserved for a future update.
              </div>
            )}
          </ScrollArea>
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
