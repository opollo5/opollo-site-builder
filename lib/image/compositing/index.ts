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

// Compositing abstraction — product code ONLY calls this function.
// Provider is selected by COMPOSITING_PROVIDER env var (default: bannerbear).
// New providers: add a case here + implement in a new file.
export async function compositeImage(
  input: CompositeInput,
): Promise<CompositeResult> {
  const { compositeBannerbear } = await import("./bannerbear");
  const { compositePlacid } = await import("./placid");

  const provider = process.env.COMPOSITING_PROVIDER ?? "bannerbear";
  switch (provider) {
    case "bannerbear":
      return compositeBannerbear(input);
    case "placid":
      return compositePlacid(input);
    default:
      throw new Error(`Unknown compositing provider: ${provider}`);
  }
}
