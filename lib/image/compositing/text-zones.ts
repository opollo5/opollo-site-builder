import type { CompositionType } from "../types";

export interface TextZone {
  x: number;       // percent of image width (left edge)
  y: number;       // percent of image height (top edge)
  width: number;   // percent of image width
  height: number;  // percent of image height
  alignment: "left" | "center" | "right";
}

// Deterministic composition → text zone mapping.
// These coordinates are fixed — never adjust per image.
// The compositing provider receives them directly.
export const TEXT_ZONE_MAP: Record<CompositionType, TextZone> = {
  split_layout: { x: 58, y: 15, width: 37, height: 70, alignment: "left" },
  gradient_fade: { x: 5, y: 15, width: 37, height: 70, alignment: "left" },
  full_background: { x: 5, y: 68, width: 90, height: 24, alignment: "center" },
  geometric: { x: 20, y: 25, width: 60, height: 50, alignment: "center" },
  texture: { x: 15, y: 20, width: 70, height: 60, alignment: "center" },
};
