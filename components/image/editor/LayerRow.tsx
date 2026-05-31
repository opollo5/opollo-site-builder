"use client";

/**
 * LayerRow — single row in the layers list panel (U4, Tier 3 polish).
 *
 * Tier 3 changes:
 *  - Lucide icons for type (Type/Image/Square), drag handle (GripVertical),
 *    ⋯ menu (MoreVertical), visibility (Eye/EyeOff), lock (Lock/Unlock)
 *  - Eye + Lock are now ONE-CLICK buttons directly in the row (Figma-style),
 *    always visible when non-default state, visible on hover otherwise.
 *    They remain in the ⋯ menu too for discoverability.
 *  - Selected row uses bg-accent/15 + left border for a clear highlight.
 *  - Layer name has a 4px gap from the type icon (was flush).
 *
 * Naming validation per §1.10: unique, slug-safe (a-z0-9_), warns on rename.
 */

import { useCallback, useRef, useState } from "react";
import {
  GripVertical, Type, Image, Square,
  Eye, EyeOff, Lock, Unlock, MoreVertical,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

  const TypeIcon =
    layer.type === "text" ? Type
    : layer.type === "image" ? Image
    : Square;

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

  const toggleHide = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "update_layer", layerId: layer.id, patch: { hide: !layer.hide } });
  };
  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({ type: "update_layer", layerId: layer.id, patch: { locked: !layer.locked } });
  };

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className={[
          // Selected: accent background + left border for a Figma-style clear indicator.
          "relative flex items-center gap-1.5 px-2 py-1.5 group cursor-pointer select-none transition-colors",
          isSelected
            ? "bg-accent/15 border-l-2 border-primary pl-[6px]"
            : "hover:bg-muted/50 border-l-2 border-transparent pl-[6px]",
        ].join(" ")}
        onClick={() => dispatch({ type: "select", layerId: isSelected ? null : layer.id })}
      >
        {/* Drag handle — GripVertical icon, revealed on hover */}
        <span
          className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          {...dragHandleProps}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <GripVertical size={14} />
        </span>

        {/* Type icon — Lucide icons for clarity */}
        <span className="text-muted-foreground shrink-0">
          <TypeIcon size={13} />
        </span>

        {/* Name — 4px gap from icon via gap-1.5 on parent */}
        {editingName ? (
          <Input
            ref={nameRef}
            defaultValue={layer.name}
            className="h-6 text-xs flex-1"
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
            className="flex-1 truncate text-xs min-w-0"
            onDoubleClick={(e: React.MouseEvent) => { e.stopPropagation(); setEditingName(true); }}
          >
            {layer.name}
          </span>
        )}

        {/* One-click Visibility toggle — always shown when hidden, hover-only when visible */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={[
                "shrink-0 transition-opacity",
                layer.hide
                  ? "text-muted-foreground opacity-100"
                  : "text-muted-foreground/30 opacity-0 group-hover:opacity-100",
              ].join(" ")}
              onClick={toggleHide}
              aria-label={layer.hide ? "Show layer" : "Hide layer"}
            >
              {layer.hide ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{layer.hide ? "Show" : "Hide"}</TooltipContent>
        </Tooltip>

        {/* One-click Lock toggle — always shown when locked, hover-only when unlocked */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={[
                "shrink-0 transition-opacity",
                layer.locked
                  ? "text-muted-foreground opacity-100"
                  : "text-muted-foreground/30 opacity-0 group-hover:opacity-100",
              ].join(" ")}
              onClick={toggleLock}
              aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
            >
              {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{layer.locked ? "Unlock" : "Lock"}</TooltipContent>
        </Tooltip>

        {/* ⋯ context menu — Rename, Duplicate, Delete (lock/hide also here for discoverability) */}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              className="shrink-0 text-muted-foreground/30 hover:text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              aria-label="Layer options"
            >
              <MoreVertical size={13} />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" align="end" sideOffset={4}>
            {menuItem(layer.locked ? "Unlock" : "Lock", () => dispatch({ type: "update_layer", layerId: layer.id, patch: { locked: !layer.locked } }))}
            {menuItem(layer.hide ? "Show" : "Hide", () => dispatch({ type: "update_layer", layerId: layer.id, patch: { hide: !layer.hide } }))}
            {menuItem("Rename", () => { setEditingName(true); })}
            {menuItem("Duplicate", duplicate)}
            <div className="border-t border-border my-1" />
            {menuItem("Delete", () => {
              if (window.confirm(`Delete layer "${layer.name}"?`)) {
                dispatch({ type: "remove_layer", layerId: layer.id });
              }
            }, true)}
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
