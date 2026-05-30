"use client";

/**
 * EditorLeftPanel — left panel of the v2 template editor.
 *
 * U1: renders the layer list in top-first order (layers array index 0 = visual top).
 * U4 adds full drag-to-reorder, context menu, groups, and variant switcher.
 */

import { useEditor } from "./EditorContext";

export function EditorLeftPanel() {
  const { state, dispatch } = useEditor();
  const { template, selectedLayerId } = state;

  return (
    <aside className="w-[280px] border-r border-border flex flex-col overflow-hidden bg-background shrink-0">
      {/* Canvas info */}
      <div className="px-3 py-2 border-b border-border text-xs text-muted-foreground flex items-center justify-between">
        <span>{template.name}</span>
        <span>{template.width} × {template.height}</span>
      </div>

      {/* Layer list (top-first) */}
      <div className="flex-1 overflow-y-auto py-1">
        {template.layers.map((layer, idx) => {
          const isSelected = layer.id === selectedLayerId;
          return (
            <button
              key={layer.id}
              className={[
                "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-muted/50 transition-colors",
                isSelected ? "bg-muted" : "",
                layer.locked ? "opacity-60" : "",
              ].join(" ")}
              onClick={() => dispatch({ type: "select", layerId: isSelected ? null : layer.id })}
            >
              {/* Type icon */}
              <span className="text-muted-foreground w-4 text-xs shrink-0">
                {layer.type === "text" ? "T"
                  : layer.type === "image" ? "⬜"
                  : "▭"}
              </span>
              <span className="truncate flex-1">{layer.name}</span>
              {layer.locked && <span className="text-muted-foreground text-xs">🔒</span>}
              {layer.hide && <span className="text-muted-foreground text-xs">○</span>}
            </button>
          );
        })}

        {template.layers.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground text-center">No layers yet</p>
        )}
      </div>

      {/* Layer count */}
      <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
        {template.layers.length} layer{template.layers.length !== 1 ? "s" : ""}
      </div>
    </aside>
  );
}
