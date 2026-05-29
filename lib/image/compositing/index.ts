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
// Provider is now always "sharp_native" (A-NEW-1 onward).
// Bannerbear and Placid providers will be removed in A-NEW-4.
// COMPOSITING_PROVIDER env var is retained for backward compat during the
// A-NEW transition but defaults to "sharp" (overriding the old "bannerbear"
// default). Remove it in A-NEW-4.
// ---------------------------------------------------------------------------
export async function compositeImage(
  input: CompositeInput,
): Promise<CompositeResult> {
  const { compositeSharp } = await import("./sharp-renderer");

  const provider = process.env.COMPOSITING_PROVIDER ?? "sharp";

  // Both "sharp" and the old un-set default ("bannerbear") now route to sharp.
  // A-NEW-4 removes the conditional entirely.
  if (provider === "bannerbear" || provider === "sharp") {
    return compositeSharp(input);
  }

  if (provider === "placid") {
    // Placid was always a stub; keeping the error for the transition period.
    throw new Error("Placid provider is not implemented. Set COMPOSITING_PROVIDER=sharp.");
  }

  throw new Error(`Unknown compositing provider: ${provider}`);
}
