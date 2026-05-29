import type { TextZone } from "./text-zones";

export type { TextZone };
export { TEXT_ZONE_MAP } from "./text-zones";

export interface LogoConfig {
  url: string; // fresh signed URL — generate at call time, not upload time
  position: "top-right" | "bottom-right" | "bottom-left" | "watermark-center";
  sizePercent: number;
  padding: number;
}

export interface CompositeInput {
  backgroundStoragePath: string;
  textZones: (TextZone & { text: string; maxFontSize: number; fontFamily?: string; colour: "white" | "dark" | "overlay" })[];
  logo: LogoConfig | null;
  outputFormat: "jpeg" | "png";
  outputWidth: number;
  outputHeight: number;
}

export interface CompositeResult {
  storagePath: string;
  provider: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Compositing abstraction — product code ONLY calls this function.
//
// A-NEW-4: Bannerbear and Placid are removed. Always uses the sharp renderer.
// Templates are resolved from the image_templates database table.
// ---------------------------------------------------------------------------
export async function compositeImage(
  input: CompositeInput,
): Promise<CompositeResult> {
  const { compositeSharp } = await import("./sharp-renderer");
  return compositeSharp(input);
}
