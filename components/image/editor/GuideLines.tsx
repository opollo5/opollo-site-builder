"use client";

/**
 * GuideLines — snap guides rendered on the Konva layer during drag (§6.4).
 *
 * Shows dashed vertical/horizontal guides when dragging a layer near:
 *   - Canvas centre, left edge, right edge, top edge, bottom edge
 *   - Other layer edges (left, center, right, top, middle, bottom)
 *
 * Guides auto-hide when the dragged layer is released.
 * "Disable Guides" in the template settings.guides field turns snapping off.
 *
 * Snap threshold: SNAP_PX pixels (5px). Guide lines rendered as Konva Lines.
 */

import { Line } from "react-konva";

export interface Guide {
  orientation: "H" | "V";
  lineGuide: number;
  snap: "start" | "center" | "end";
  diff: number;
}

interface GuideLinesProps {
  guides: Guide[];
  width: number;
  height: number;
}

export function GuideLines({ guides, width, height }: GuideLinesProps) {
  return (
    <>
      {guides.map((g, i) =>
        g.orientation === "H" ? (
          <Line
            key={i}
            points={[0, g.lineGuide, width, g.lineGuide]}
            stroke="#3b82f6"
            strokeWidth={1}
            dash={[6, 3]}
            listening={false}
          />
        ) : (
          <Line
            key={i}
            points={[g.lineGuide, 0, g.lineGuide, height]}
            stroke="#3b82f6"
            strokeWidth={1}
            dash={[6, 3]}
            listening={false}
          />
        ),
      )}
    </>
  );
}

// ─── Snap computation ─────────────────────────────────────────────────────────

const SNAP_PX = 6;

interface LayerBounds {
  id: string;
  left: number;
  centerH: number;
  right: number;
  top: number;
  centerV: number;
  bottom: number;
}

function boundsOf(
  x: number, y: number, w: number, h: number, id: string,
): LayerBounds {
  return {
    id,
    left: x, centerH: x + w / 2, right: x + w,
    top: y,  centerV: y + h / 2, bottom: y + h,
  };
}

export function computeSnap(
  dragging: { x: number; y: number; width: number; height: number; id: string },
  allLayers: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  canvasW: number,
  canvasH: number,
): { x: number; y: number; guides: Guide[] } {
  const db = boundsOf(dragging.x, dragging.y, dragging.width, dragging.height, dragging.id);

  // Reference lines: canvas edges + centre + other layers.
  const hRefs: number[] = [0, canvasH / 2, canvasH];
  const vRefs: number[] = [0, canvasW / 2, canvasW];

  for (const l of allLayers) {
    if (l.id === dragging.id) continue;
    const b = boundsOf(l.x, l.y, l.width, l.height, l.id);
    hRefs.push(b.top, b.centerV, b.bottom);
    vRefs.push(b.left, b.centerH, b.right);
  }

  const guides: Guide[] = [];
  let snapX = dragging.x;
  let snapY = dragging.y;

  // Vertical snapping (affects x)
  const dEdgesV = [
    { snap: "start" as const, val: db.left },
    { snap: "center" as const, val: db.centerH },
    { snap: "end" as const, val: db.right },
  ];
  let bestV = SNAP_PX + 1;
  for (const ref of vRefs) {
    for (const { snap, val } of dEdgesV) {
      const diff = Math.abs(val - ref);
      if (diff < SNAP_PX && diff < bestV) {
        bestV = diff;
        const dx = ref - val;
        snapX = dragging.x + dx;
        // Guard: findIndex returns -1 when no V guide exists yet. splice(-1,1)
        // would incorrectly remove the last element (possibly an H guide).
        const vIdx = guides.findIndex((g) => g.orientation === "V");
        if (vIdx !== -1) guides.splice(vIdx, 1);
        guides.push({ orientation: "V", lineGuide: ref, snap, diff });
      }
    }
  }

  // Horizontal snapping (affects y)
  const dEdgesH = [
    { snap: "start" as const, val: db.top },
    { snap: "center" as const, val: db.centerV },
    { snap: "end" as const, val: db.bottom },
  ];
  let bestH = SNAP_PX + 1;
  for (const ref of hRefs) {
    for (const { snap, val } of dEdgesH) {
      const diff = Math.abs(val - ref);
      if (diff < SNAP_PX && diff < bestH) {
        bestH = diff;
        const dy = ref - val;
        snapY = dragging.y + dy;
        const hIdx = guides.findIndex((g) => g.orientation === "H");
        if (hIdx !== -1) guides.splice(hIdx, 1);
        guides.push({ orientation: "H", lineGuide: ref, snap, diff });
      }
    }
  }

  return { x: Math.round(snapX), y: Math.round(snapY), guides };
}
