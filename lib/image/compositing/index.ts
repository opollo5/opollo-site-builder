import type { TextZone } from "./text-zones";
import type { RenderTemplateInput } from "./layer-renderer";

export type { TextZone };
export { TEXT_ZONE_MAP } from "./text-zones";

export interface LogoConfig {
  url: string; // fresh signed URL — generate at call time, not upload time
  position: "top-right" | "bottom-right" | "bottom-left" | "watermark-center";
  sizePercent: number;
  padding: number;
}

/** Legacy fixed-zone input (schema_version=1, A-NEW-3 format). */
export interface CompositeInput {
  backgroundStoragePath: string;
  textZones: (TextZone & { text: string; maxFontSize: number; fontFamily?: string; colour: "white" | "dark" | "overlay" })[];
  logo: LogoConfig | null;
  outputFormat: "jpeg" | "png";
  outputWidth: number;
  outputHeight: number;
}

/**
 * Layer-based input (schema_version=2, v2 editor format).
 *
 * Callers provide a fully-resolved Template object (from D3 get_template())
 * plus optional modifications and variant key.
 * The output is uploaded to `outputStoragePath` in the generated-images bucket.
 */
export interface LayerCompositeInput {
  schema_version: 2;
  template: RenderTemplateInput["template"];
  modifications?: RenderTemplateInput["modifications"];
  variantKey?: string;
  /** Destination path in the generated-images bucket (caller-supplied). */
  outputStoragePath: string;
  /** Output format; defaults to template.render_settings.format. */
  outputFormat?: "jpeg" | "png";
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
// E8: Dispatches to the layer-based renderer for schema_version=2 templates;
//     falls back to the fixed-zone renderer for unmigrated (schema_version=1).
// ---------------------------------------------------------------------------
export async function compositeImage(
  input: CompositeInput | LayerCompositeInput,
): Promise<CompositeResult> {
  if ("schema_version" in input && input.schema_version === 2) {
    const { compositeLayerBased } = await import("./layer-composite");
    return compositeLayerBased(input);
  }
  const { compositeSharp } = await import("./sharp-renderer");
  return compositeSharp(input as CompositeInput);
}
