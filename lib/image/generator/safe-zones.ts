/**
 * safe-zones.ts — Derive keep-clear regions and build D30 prompt fragments.
 *
 * D11: Derive keep-clear rects from text/logo layer positions, normalised 0–1.
 * D29: Map coordinates to a fixed 3×3 grid (GridRegion).
 * D30: Build the exact composition-constraints prompt fragment.
 *
 * Used by buildPrompt (PRIMARY path) and available for Slice I feedback pins
 * (same grid, same builder).
 */

import type { TextZone } from "@/lib/image/compositing/text-zones";

// ─── D29: 3×3 grid ───────────────────────────────────────────────────────────

export type GridRegion =
  | "top-left"    | "top-center"    | "top-right"
  | "mid-left"    | "center"        | "mid-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

/**
 * Map normalised coordinates (0–1) to the 3×3 GridRegion they fall in.
 * The grid divides the image into equal thirds on each axis.
 */
export function coordToGridRegion(xNorm: number, yNorm: number): GridRegion {
  const col = xNorm < 1 / 3 ? "left" : xNorm < 2 / 3 ? "center" : "right";
  const row = yNorm < 1 / 3 ? "top" : yNorm < 2 / 3 ? "mid" : "bottom";

  if (row === "top") {
    return col === "left" ? "top-left" : col === "center" ? "top-center" : "top-right";
  }
  if (row === "mid") {
    return col === "left" ? "mid-left" : col === "center" ? "center" : "mid-right";
  }
  return col === "left" ? "bottom-left" : col === "center" ? "bottom-center" : "bottom-right";
}

/**
 * Convert TextZone coordinates (0–100 percentages) to GridRegions via the
 * zone's centre point.
 */
export function textZonesToGridRegions(zones: TextZone[]): GridRegion[] {
  const seen = new Set<GridRegion>();
  const out: GridRegion[] = [];
  for (const zone of zones) {
    const cx = (zone.x + zone.width / 2) / 100;
    const cy = (zone.y + zone.height / 2) / 100;
    const region = coordToGridRegion(cx, cy);
    if (!seen.has(region)) {
      seen.add(region);
      out.push(region);
    }
  }
  return out;
}

// ─── D30: prompt fragment ─────────────────────────────────────────────────────

/**
 * Build the exact D30 keep-clear composition hint.
 * Returns empty string when regions is empty (no constraint added).
 *
 * Exact format (authoritative per brief §1.1 D30):
 *   "Composition constraints: keep the {regions} area(s) visually simple and
 *    low-detail for overlaid text and logo. Do not place faces, hands, product
 *    hero elements, or fine details there."
 */
export function buildSafeZoneFragment(regions: GridRegion[]): string {
  if (regions.length === 0) return "";
  const label = regions.join(", ");
  return `Composition constraints: keep the ${label} area(s) visually simple and low-detail for overlaid text and logo. Do not place faces, hands, product hero elements, or fine details there.`;
}
