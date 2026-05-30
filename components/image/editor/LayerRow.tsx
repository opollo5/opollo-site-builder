"use client";

/**
 * LayerRow — single row in the layers list panel (U4).
 *
 * Features: type icon, editable name (double-click), lock/hide indicators,
 * drag handle for reorder, ⋯ context menu (Radix Popover) with:
 *   Toggle Lock · Toggle Hide · Rename · Duplicate · Delete
 *
 * Naming validation per §1.10: unique, slug-safe (a-z0-9_), warns on rename.
 */

import { useCallback, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useEditor } from "./EditorContext";
import type { Layer } from "@/lib/image/template-model";

const SLUG_RE = /^[a-z0-9_]+$/;

interface LayerRowProps {
  layer: Layer;
  index: number;
  isSelected: boolean;
  dragHandleProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent<HTMLSpanElement>) => void;
    onDragEnd: () => void;
  };
}

export function LayerRow({ layer, index, isSelected, dragHandleProps }: LayerRowProps) {
  const { state, dispatch } = useEditor();
  const [editingName, setEditingName] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const typeIcon =
    layer.type === "text" ? "T"
    : layer.type === "image" ? "⬜"
    : "▭";

  const commitName = useCallback(() => {
    setEditingName(false);
    const raw = nameRef.current?.value.trim() ?? "";
    if (!raw || raw === layer.name) return;
    if (!SLUG_RE.test(raw)) {
      alert(`Layer name must be slug-safe (a-z, 0-9, _). "${raw}" is invalid.`);
      return;
    }
    if (state.template.layers.some((l) => l.id !== layer.id && l.name === raw)) {
      alert(`Name "${raw}" is already used — names must be unique.`);
      return;
    }
    if (!window.confirm(`Rename "${layer.name}" → "${raw}"?\n\nThis breaks external modification API calls using the old name.`)) return;
    dispatch({ type: "update_layer", layerId: layer.id, patch: { name: raw } });
  }, [layer.id, layer.name, state.template.layers, dispatch]);

  const duplicate = useCallback(() => {
    setMenuOpen(false);
    const copy: Layer = {
      ...layer,
      id: `${layer.id}_copy_${Date.now()}`,
      name: `${layer.name}_copy`,
      x: layer.x + 16,
      y: layer.y + 16,
    };
    dispatch({ type: "add_layer", layer: copy, index });
  }, [layer, index, dispatch]);

  const menuItem = (label: string, action: () => void, danger = false) => (
    <button
      key={label}
      className={[
        "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors",
        danger ? "text-destructive hover:text-destructive" : "",
      ].join(" ")}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); action(); setMenuOpen(false); }}
    >
      {label}
    </button>
  );

  return (
    <div
      className={[
        "flex items-center gap-1 px-2 py-1.5 group cursor-pointer select-none",
        isSelected ? "bg-muted" : "hover:bg-muted/50",
        layer.locked ? "opacity-60" : "",
      ].join(" ")}
      onClick={() => dispatch({ type: "select", layerId: isSelected ? null : layer.id })}
    >
      {/* Drag handle */}
      <span
        className="text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover:opacity-100 text-sm"
        {...dragHandleProps}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        ⠿
      </span>

      {/* Type icon */}
      <span className="text-muted-foreground w-4 text-center text-xs shrink-0">{typeIcon}</span>

      {/* Name */}
      {editingName ? (
        <Input
          ref={nameRef}
          defaultValue={layer.name}
          className="h-6 text-xs flex-1 py-0"
          autoFocus
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          onBlur={commitName}
          onKeyDown={(e: React.KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") setEditingName(false);
          }}
        />
      ) : (
        <span
          className="flex-1 truncate text-xs"
          onDoubleClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditingName(true); }}
        >
          {layer.name}
        </span>
      )}

      {layer.hide && <span className="text-muted-foreground text-xs shrink-0">○</span>}
      {layer.locked && <span className="text-muted-foreground text-xs shrink-0">🔒</span>}

      {/* Context menu */}
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <button
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground px-1 text-xs shrink-0"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          >
            ⋯
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-40 p-1" align="end" sideOffset={4}>
          {menuItem(
            layer.locked ? "Unlock" : "Lock",
            () => dispatch({ type: "update_layer", layerId: layer.id, patch: { locked: !layer.locked } }),
          )}
          {menuItem(
            layer.hide ? "Show" : "Hide",
            () => dispatch({ type: "update_layer", layerId: layer.id, patch: { hide: !layer.hide } }),
          )}
          {menuItem("Rename", () => { setEditingName(true); })}
          {menuItem("Duplicate", duplicate)}
          <div className="border-t border-border my-1" />
          {menuItem(
            "Delete",
            () => {
              if (window.confirm(`Delete layer "${layer.name}"?`)) {
                dispatch({ type: "remove_layer", layerId: layer.id });
              }
            },
            true,
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
