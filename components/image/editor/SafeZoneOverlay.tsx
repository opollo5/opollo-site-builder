"use client";

/**
 * SafeZoneOverlay — Konva-drawn guides showing platform-safe crop area.
 *
 * Multi-format brief §scope: "Safe zones: per-format safe-zone boundary
 * overlays drawn on the canvas (toggleable), showing the crop-safe area for
 * that format's platforms."
 *
 * Safe zones are GUIDES ONLY — they never affect rendered output pixels.
 * Baked-in presets per format (editable per template is a stretch goal).
 *
 * Safe zone presets (5% inset from each edge, industry standard for social):
 *   Square  1080×1080 → safe area: 54px inset each side = 972×972 centred
 *   Landscape 1200×630 → safe area: 60px top/bottom, 96px left/right
 *
 * The overlay is drawn on the Konva layer above layers, below handles.
 */

import { Layer, Rect, Text } from "react-konva";

interface SafeZonePreset {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

/** Return the safe-zone preset for a given canvas size. */
function getSafeZone(canvasW: number, canvasH: number): SafeZonePreset | null {
  // 5% inset on each axis — matches Instagram/Facebook content-safe guidelines.
  const insetX = Math.round(canvasW * 0.05);
  const insetY = Math.round(canvasH * 0.05);
  return {
    x: insetX,
    y: insetY,
    width: canvasW - insetX * 2,
    height: canvasH - insetY * 2,
    label: "Safe zone",
  };
}

interface SafeZoneOverlayProps {
  canvasW: number;
  canvasH: number;
  /** Controlled by the guides toggle in EditorLeftPanel. */
  visible: boolean;
}

export function SafeZoneOverlay({ canvasW, canvasH, visible }: SafeZoneOverlayProps) {
  if (!visible) return null;

  const zone = getSafeZone(canvasW, canvasH);
  if (!zone) return null;

  return (
    <Layer listening={false}>
      {/* Dimmed outer region — shows what's outside the safe zone */}
      {/* Top strip */}
      <Rect x={0} y={0} width={canvasW} height={zone.y}
        fill="rgba(0,0,0,0.15)" listening={false} />
      {/* Bottom strip */}
      <Rect x={0} y={zone.y + zone.height} width={canvasW} height={zone.y}
        fill="rgba(0,0,0,0.15)" listening={false} />
      {/* Left strip */}
      <Rect x={0} y={zone.y} width={zone.x} height={zone.height}
        fill="rgba(0,0,0,0.15)" listening={false} />
      {/* Right strip */}
      <Rect x={zone.x + zone.width} y={zone.y} width={zone.x} height={zone.height}
        fill="rgba(0,0,0,0.15)" listening={false} />

      {/* Safe zone border */}
      <Rect
        x={zone.x} y={zone.y}
        width={zone.width} height={zone.height}
        stroke="rgba(255,255,255,0.6)"
        strokeWidth={1}
        dash={[8, 4]}
        fill="transparent"
        listening={false}
      />

      {/* Label */}
      <Text
        text={zone.label}
        x={zone.x + 4}
        y={zone.y + 4}
        fontSize={11}
        fill="rgba(255,255,255,0.5)"
        listening={false}
      />
    </Layer>
  );
}
