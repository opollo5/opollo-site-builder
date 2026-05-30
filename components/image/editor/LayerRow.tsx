"use client";

/**
 * LayerRow — single row in the layers list panel (U4).
 *
 * Features: type icon, editable name (double-click), lock/hide toggles,
 * drag handle for reorder, context menu (⋯) with:
 *   Toggle Lock · Rename · Duplicate · Add to Group · Edit Description · Delete
 *
 * Rename changes the binding key (layer.name) with validation:
 *   - unique within template
 *   - slug-safe (a-z0-9_) per §1.10
 *   - warns if name changes (breaks external modification calls)
 */

import { useCallback, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useEditor } from "./EditorContext";
import type { Layer } from "@/lib/image/template-model";

const SLUG_RE = /^[a-z0-9_]+$/;

interface LayerRowProps {
  layer: Layer;
  index: number;
  isSelected: boolean;
  /** Drag-and-drop handlers passed by EditorLeftPanel */
  dragHandleProps: {
    draggable: boolean;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
}

export function LayerRow({ layer, index, isSelected, dragHandleProps }: LayerRowProps) {
  const { state, dispatch } = useEditor();
  const [editingName, setEditingName] = useState(false);
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
      alert(`Layer name must be slug-safe (a-z, 0-9, underscore). "${raw}" is invalid.`);
      return;
    }
    const duplicate = state.template.layers.some((l) => l.id !== layer.id && l.name === raw);
    if (duplicate) {
      alert(`Layer name "${raw}" is already used. Names must be unique within a template.`);
      return;
    }
    const changed = raw !== layer.name;
    if (changed) {
      const confirmed = window.confirm(
        `Rename "${layer.name}" → "${raw}"?\n\nThis will break any existing modification API calls that use the old name.`,
      );
      if (!confirmed) return;
    }
    dispatch({ type: "update_layer", layerId: layer.id, patch: { name: raw } });
  }, [layer.id, layer.name, state.template.layers, dispatch]);

  const duplicate = useCallback(() => {
    const copy: Layer = {
      ...layer,
      id: `${layer.id}_copy_${Date.now()}`,
      name: `${layer.name}_copy`,
      x: layer.x + 16,
      y: layer.y + 16,
    };
    dispatch({ type: "add_layer", layer: copy, index });
  }, [layer, index, dispatch]);

  return (
    <div
      className={[
        "flex items-center gap-1 px-2 py-1.5 text-sm group cursor-pointer select-none",
        isSelected ? "bg-muted" : "hover:bg-muted/50",
        layer.locked ? "opacity-60" : "",
      ].join(" ")}
      onClick={() => dispatch({ type: "select", layerId: isSelected ? null : layer.id })}
    >
      {/* Drag handle */}
      <span
        className="text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover:opacity-100"
        {...dragHandleProps}
        onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => e.stopPropagation()}
          onBlur={commitName}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") setEditingName(false);
          }}
        />
      ) : (
        <span
          className="flex-1 truncate text-xs"
          onDoubleClick={(e) => { e.stopPropagation(); setEditingName(true); }}
        >
          {layer.name}
        </span>
      )}

      {/* Indicators */}
      {layer.hide && <span className="text-muted-foreground text-xs">○</span>}
      {layer.locked && <span className="text-muted-foreground text-xs">🔒</span>}

      {/* Context menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground px-1 text-xs">
            ⋯
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "update_layer", layerId: layer.id, patch: { locked: !layer.locked } });
            }}
          >
            {layer.locked ? "Unlock" : "Lock"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              dispatch({ type: "update_layer", layerId: layer.id, patch: { hide: !layer.hide } });
            }}
          >
            {layer.hide ? "Show" : "Hide"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => { e.stopPropagation(); setEditingName(true); }}
          >
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={(e) => { e.stopPropagation(); duplicate(); }}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Delete layer "${layer.name}"?`)) {
                dispatch({ type: "remove_layer", layerId: layer.id });
              }
            }}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
