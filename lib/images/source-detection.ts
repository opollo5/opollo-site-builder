import { parseIstockIdFromFilename } from "@/lib/image-dimensions";
import type { ImageLibrarySource } from "@/lib/image-library";

export type DetectedImageSource = {
  source: ImageLibrarySource;
  source_ref: string;
};

export function detectImageSource(filename: string): DetectedImageSource {
  const istockId = parseIstockIdFromFilename(filename);
  if (istockId) {
    return { source: "istock", source_ref: istockId };
  }
  return { source: "upload", source_ref: filename };
}
