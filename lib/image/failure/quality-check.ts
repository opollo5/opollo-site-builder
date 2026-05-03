import type { CompositionType } from "../types";
import { TEXT_ZONE_MAP } from "../compositing/text-zones";

export interface QualityResult {
  passed: boolean;
  luminanceScore: number;
  safeZoneScore: number;
  reason?: string;
}

export function selectOverlayColour(
  luminanceScore: number,
): "white" | "dark" | "overlay" {
  if (luminanceScore < 160) return "white";
  if (luminanceScore > 180) return "dark";
  return "overlay";
}

// I3: Full quality check (luminance + safe zone) implemented once `sharp`
// is installed. For I1 the handler uses this stub which always passes so
// the generation pipeline is exercisable end-to-end before I3 lands.
export async function qualityCheck(
  _imageBuffer: Buffer,
  _compositionType: CompositionType,
): Promise<QualityResult> {
  void TEXT_ZONE_MAP; // referenced so the import isn't dead-code
  return { passed: true, luminanceScore: 128, safeZoneScore: 0 };
}
