"use client";

/**
 * EditorRightPanel — right properties panel of the v2 template editor.
 *
 * U1: renders a placeholder showing the selected layer's type and name.
 * U5-U10 add the full properties panels per layer type.
 */

import { useEditor } from "./EditorContext";

export function EditorRightPanel() {
  const { selectedLayer } = useEditor();

  return (
    <aside className="w-[280px] border-l border-border flex flex-col overflow-hidden bg-background shrink-0">
      {selectedLayer ? (
        <>
          <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-between">
            <span className="font-medium text-foreground">{selectedLayer.name}</span>
            <span className="capitalize">{selectedLayer.type}</span>
          </div>

          <div className="flex-1 overflow-y-auto py-3 px-3">
            {/* Properties panels slot in from U5-U10 */}
            <div className="text-xs text-muted-foreground text-center py-8">
              Properties panel coming in U5–U10
            </div>
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
