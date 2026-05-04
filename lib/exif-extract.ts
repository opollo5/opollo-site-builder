import { parse as parseExif } from "exifr";

// ---------------------------------------------------------------------------
// Canonical EXIF/IPTC/XMP extraction for image uploads and re-extraction.
//
// Field precedence (matches IPTC/XMP/TIFF industry conventions):
//   caption  ← IPTC Caption-Abstract ?? XMP description ?? IPTC Headline
//   alt_text ← IPTC Headline ?? IPTC ObjectName ?? XMP Title
//   tags     ← IPTC Keywords OR XMP Subject array, max 12 items
//
// Returns null fields when no usable data found. Exported so upload route
// and reextract lib stay in sync — never duplicate the mapping.
// ---------------------------------------------------------------------------

export type ExifFields = {
  caption: string | null;
  alt_text: string | null;
  tags: string[];
  raw: Record<string, unknown>;
};

const TAG_LIMIT = 12;

export async function extractExifFields(
  buffer: ArrayBuffer,
): Promise<ExifFields | null> {
  const raw = (await parseExif(buffer, {
    tiff: true,
    xmp: true,
    iptc: true,
    icc: false,
    reviveValues: true,
  })) as Record<string, unknown> | undefined;

  if (!raw) return null;

  const str = (v: unknown): string | null => {
    if (typeof v === "string" && v.trim()) return v.trim();
    return null;
  };

  const caption =
    str(raw["Caption-Abstract"]) ??
    str(raw.description) ??
    str(raw.Headline) ??
    null;

  const alt_text =
    str(raw.Headline) ??
    str(raw.ObjectName) ??
    str(raw.Title) ??
    null;

  // Collect tags from IPTC Keywords or XMP Subject (whichever is richer).
  const toTagArray = (v: unknown): string[] => {
    if (typeof v === "string" && v.trim())
      return v.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    if (Array.isArray(v))
      return (v as unknown[]).map((s) => String(s).trim()).filter(Boolean);
    return [];
  };
  const kwTags = toTagArray(raw.Keywords);
  const subTags = toTagArray(raw.Subject);
  const tags = (kwTags.length >= subTags.length ? kwTags : subTags).slice(0, TAG_LIMIT);

  return { caption, alt_text, tags, raw };
}
