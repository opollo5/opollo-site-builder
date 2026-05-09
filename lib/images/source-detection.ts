import { parseIstockIdFromFilename } from "@/lib/image-dimensions";
import type { ImageLibrarySource } from "@/lib/image-library";

export type DetectedImageSource = {
  source: ImageLibrarySource;
  sourceRef: string;
};

/**
 * Detects whether a filename belongs to an iStock image using the shared
 * parseIstockIdFromFilename helper (matches iStock[-_]<6+digits> anywhere
 * in the basename). When detected, source is set to "istock" and sourceRef
 * to the numeric ID alone — matching the convention used by the iStock CSV
 * seed path so that both ingest paths share the same (source, source_ref)
 * unique namespace.
 */
export function detectImageSource(filename: string): DetectedImageSource {
  const istockId = parseIstockIdFromFilename(filename);
  if (istockId) {
    return { source: "istock", sourceRef: istockId };
  }
  return { source: "upload", sourceRef: filename };
}
