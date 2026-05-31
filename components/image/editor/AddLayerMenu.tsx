"use client";

/**
 * AddLayerMenu — the "+ Layer" popover for adding new layers to the template.
 *
 * Offers Text, Image, and Rectangle layer types. Each creates a sensibly-sized
 * default layer centred in the canvas, immediately selectable and editable.
 * Dispatches add_layer at index 0 (inserts at the visual top of the stack).
 */

import { useState } from "react";
import { Circle, Triangle, Minus, Diamond, Pentagon, Hexagon, Star, ArrowRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useEditor } from "./EditorContext";
import type {
  TextLayer,
  ImageLayer,
  RectangleLayer,
  ShapeLayer,
  ShapeKind,
  Layer,
} from "@/lib/image/template-model";

// ─── Default layer factories ───────────────────────────────────────────────────

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}`;
}

const BASE = {
  rotation: 0, rotate_x: 0, rotate_y: 0, rotate_z: 0,
  skew_x: 0, skew_y: 0, opacity: 1,
  locked: false, hide: false, hide_when_empty: false,
  lock_aspect_ratio: false, description: "", group: null,
  constraints: { horizontal: "left" as const, vertical: "top" as const },
};

function makeTextLayer(canvasW: number, canvasH: number, existingNames: string[]): TextLayer {
  const name = uniqueName("text", existingNames);
  const w = Math.round(canvasW * 0.7);
  const h = Math.round(canvasH * 0.15);
  return {
    ...BASE,
    id: uid("text"),
    name,
    type: "text",
    x: Math.round((canvasW - w) / 2),
    y: Math.round((canvasH - h) / 2),
    width: w,
    height: h,
    text: "New text layer",
    font_family: "Inter",
    font_size: 48,
    font_weight: 700,
    color: "#ffffff",
    text_align_h: "center",
    text_align_v: "center",
    letter_spacing: 0,
    line_height: 1.2,
    text_transform: "none",
    text_decoration: "none",
    word_break: "normal",
    style: "",
    direction: "ltr",
    text_fit: { enabled: false, min_size: 16, max_size: 120, max_lines: 4 },
    truncate: false,
    text_box: { padding: null, border: null },
    background: {
      color: null, border: null, border_width: null,
      padding_h: 0, padding_v: 0, shadow: null, radius: null, shift: null,
    },
    secondary: { font_family: null, color: null },
  };
}

function makeImageLayer(canvasW: number, canvasH: number, existingNames: string[]): ImageLayer {
  const name = uniqueName("image", existingNames);
  const size = Math.round(Math.min(canvasW, canvasH) * 0.5);
  return {
    ...BASE,
    id: uid("image"),
    name,
    type: "image",
    x: Math.round((canvasW - size) / 2),
    y: Math.round((canvasH - size) / 2),
    width: size,
    height: size,
    asset_id: null,
    image_url: null,
    fill: "cover",
    anchor_x: "center",
    anchor_y: "center",
    tint_color: null,
    border_radius: 0,
    clip_path: null,
    face_detect: false,
    hide_when_empty: true,
  };
}

function makeRectLayer(canvasW: number, canvasH: number, existingNames: string[]): RectangleLayer {
  const name = uniqueName("rectangle", existingNames);
  const w = Math.round(canvasW * 0.4);
  const h = Math.round(canvasH * 0.25);
  return {
    ...BASE,
    id: uid("rect"),
    name,
    type: "rectangle",
    x: Math.round((canvasW - w) / 2),
    y: Math.round((canvasH - h) / 2),
    width: w,
    height: h,
    color: "#7c3aed",
    gradient: null,
    border_radius: 8,
    border: null,
  };
}

function makeShapeLayer(
  kind: ShapeKind,
  canvasW: number,
  canvasH: number,
  existingNames: string[],
): ShapeLayer {
  const name = uniqueName(kind, existingNames);
  const isLine = kind === "line";
  const w = Math.round(canvasW * (isLine ? 0.6 : 0.35));
  const h = Math.round(isLine ? canvasH * 0.03 : canvasH * 0.35);
  return {
    ...BASE,
    id: uid(kind),
    name,
    type: "shape",
    shapeKind: kind,
    x: Math.round((canvasW - w) / 2),
    y: Math.round((canvasH - h) / 2),
    width: w,
    height: h,
    color: "#7c3aed",
    gradient: null,
    border: null,
  };
}

const SHAPE_OPTIONS: { kind: ShapeKind; label: string; icon: React.ElementType }[] = [
  { kind: "ellipse",       label: "Ellipse / Circle", icon: Circle },
  { kind: "triangle",      label: "Triangle",          icon: Triangle },
  { kind: "right_triangle",label: "Right Triangle",    icon: Triangle },
  { kind: "diamond",       label: "Diamond",           icon: Diamond },
  { kind: "pentagon",      label: "Pentagon",          icon: Pentagon },
  { kind: "hexagon",       label: "Hexagon",           icon: Hexagon },
  { kind: "star",          label: "Star",              icon: Star },
  { kind: "arrow",         label: "Arrow",             icon: ArrowRight },
  { kind: "line",          label: "Line",              icon: Minus },
];

/** Generate a slug-safe unique name not already in the template. */
function uniqueName(prefix: string, existing: string[]): string {
  for (let i = 1; i <= 99; i++) {
    const candidate = `${prefix}_${String(i).padStart(2, "0")}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${prefix}_${Date.now().toString(36)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

const menuItemCls = "w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors rounded flex items-center gap-2";

/**
 * AddLayerMenu — in-place drill-down navigation (no flyout submenus).
 *
 * Root view: Text / Image / Rectangle / Shape.
 * Clicking "Shape" replaces the list in-place with shape options + a ← Back
 * button. No positioning math — the same Radix Popover bounds it correctly
 * regardless of where the trigger sits on-screen.
 */
export function AddLayerMenu() {
  const { state, dispatch } = useEditor();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "shapes">("root");

  const { width, height, layers } = state.template;
  const existingNames = layers.map((l) => l.name);

  function addLayer(layer: Layer) {
    setOpen(false);
    setView("root");
    dispatch({ type: "add_layer", layer, index: 0 });
  }

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setView("root"); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
          + Layer
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="end" sideOffset={4}>
        {view === "shapes" ? (
          /* ── Shape drill-down view ── */
          <>
            <button
              className={[menuItemCls, "text-muted-foreground"].join(" ")}
              onClick={() => setView("root")}
            >
              <span className="text-xs leading-none">←</span>
              <span>Back</span>
            </button>
            <div className="border-t border-border my-1" />
            {SHAPE_OPTIONS.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                className={menuItemCls}
                onClick={() => addLayer(makeShapeLayer(kind, width, height, existingNames))}
              >
                <Icon size={13} className="text-muted-foreground shrink-0" />
                {label}
              </button>
            ))}
          </>
        ) : (
          /* ── Root view ── */
          <>
            <button className={menuItemCls}
              onClick={() => addLayer(makeTextLayer(width, height, existingNames))}>
              <span className="w-4 text-center text-muted-foreground font-bold text-sm leading-none">T</span>
              Text
            </button>
            <button className={menuItemCls}
              onClick={() => addLayer(makeImageLayer(width, height, existingNames))}>
              <span className="w-4 text-center text-muted-foreground text-sm leading-none">⬜</span>
              Image
            </button>
            <button className={menuItemCls}
              onClick={() => addLayer(makeRectLayer(width, height, existingNames))}>
              <span className="w-4 text-center text-muted-foreground text-sm leading-none">▭</span>
              Rectangle
            </button>
            <button
              className={[menuItemCls, "justify-between"].join(" ")}
              onClick={() => setView("shapes")}
            >
              <span className="flex items-center gap-2">
                <Circle size={13} className="text-muted-foreground" />
                Shape
              </span>
              <span className="text-muted-foreground text-xs leading-none">›</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
