import "server-only";

import ExcelJS from "exceljs";

import { MASS_GEN_PLATFORM_MAP } from "@/lib/image/types";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// C1 — XLSX parser for the mass-image-gen ingestion pipeline.
//
// §1.4 of MASS_IMAGE_GEN_BUILD_BRIEF. Reads the first sheet of an .xlsx
// file, validates against the label-based schema, and returns a list of
// canonical PostRow objects. Strict failure model: any structural error
// rejects the whole file with a clear message; per-row data errors reject
// the row with row number context.
// ---------------------------------------------------------------------------

const REQUIRED_COLUMNS = [
  "post_topic",
  "headline_text",
  "body_text",
  "target_platforms",
] as const;

const OPTIONAL_COLUMNS = [
  "style_hint",
  "composition_hint",
  "publish_date",
  "notes",
] as const;

const KNOWN_COLUMNS = new Set<string>([...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS]);

export const STYLE_HINT_VALUES = [
  "clean_corporate",
  "bold_promo",
  "minimal_modern",
  "editorial",
  "product_focus",
] as const;

export const COMPOSITION_HINT_VALUES = [
  "split_layout",
  "gradient_fade",
  "full_background",
  "geometric",
  "texture",
] as const;

export type StyleHint = (typeof STYLE_HINT_VALUES)[number];
export type CompositionHint = (typeof COMPOSITION_HINT_VALUES)[number];

const KNOWN_PLATFORMS = new Set(Object.keys(MASS_GEN_PLATFORM_MAP));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface PostRow {
  /** 1-indexed row number in the source sheet (header row = 1; first data row = 2). */
  sourceRow: number;
  post_topic: string;
  headline_text: string;
  body_text: string;
  target_platforms: string[];
  style_hint?: StyleHint;
  composition_hint?: CompositionHint;
  publish_date?: string; // YYYY-MM-DD
  notes?: string;
}

export type XlsxParseResult =
  | {
      ok: true;
      posts: PostRow[];
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
      details?: {
        sourceRow?: number;
        missingColumns?: string[];
        unknownValue?: string;
      };
    };

/**
 * Parse an XLSX file buffer into canonical PostRow objects.
 *
 * @param buffer raw .xlsx bytes (e.g. from a multipart upload).
 */
export async function parseXlsxBuffer(buffer: Buffer | ArrayBuffer): Promise<XlsxParseResult> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as ArrayBuffer);
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse XLSX file: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const ws = wb.worksheets[0];
  if (!ws) {
    return { ok: false, error: "Workbook contains no sheets." };
  }
  if (wb.worksheets.length > 1) {
    logger.info("xlsx_parse.multi_sheet_ignored", {
      sheetCount: wb.worksheets.length,
      usedSheet: ws.name,
    });
  }

  // ─── Header row ──────────────────────────────────────────────────────────
  const headerRow = ws.getRow(1);
  if (!headerRow || headerRow.cellCount === 0) {
    return { ok: false, error: "Sheet has no header row." };
  }

  const columnIndex: Record<string, number> = {};
  const warnings: string[] = [];

  // Iterate explicitly across cells so we get blank cells too.
  for (let c = 1; c <= headerRow.cellCount; c++) {
    const raw = cellString(headerRow.getCell(c));
    if (!raw) continue;
    const key = raw.trim().toLowerCase();
    if (KNOWN_COLUMNS.has(key)) {
      columnIndex[key] = c;
    } else {
      warnings.push(`Unknown column "${raw}" ignored.`);
    }
  }

  const missing = REQUIRED_COLUMNS.filter((col) => !(col in columnIndex));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `XLSX is missing required column(s): ${missing.join(", ")}`,
      details: { missingColumns: [...missing] },
    };
  }

  // ─── Data rows ───────────────────────────────────────────────────────────
  const posts: PostRow[] = [];
  const lastRow = ws.actualRowCount; // exceljs: actualRowCount counts populated rows

  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    if (rowIsBlank(row, columnIndex)) continue;

    const postTopic = readString(row, columnIndex.post_topic);
    const headline = readString(row, columnIndex.headline_text);
    const body = readString(row, columnIndex.body_text);
    const platformsRaw = readString(row, columnIndex.target_platforms);

    for (const [name, value] of [
      ["post_topic", postTopic],
      ["headline_text", headline],
      ["body_text", body],
      ["target_platforms", platformsRaw],
    ] as const) {
      if (!value) {
        return {
          ok: false,
          error: `Row ${r}: required column "${name}" is empty.`,
          details: { sourceRow: r },
        };
      }
    }

    // ── target_platforms ──
    const platforms: string[] = [];
    for (const piece of platformsRaw!.split(",")) {
      const code = piece.trim().toLowerCase();
      if (!code) continue;
      if (!KNOWN_PLATFORMS.has(code)) {
        return {
          ok: false,
          error: `Row ${r}: unknown platform code "${code}". Known: ${[...KNOWN_PLATFORMS].join(", ")}`,
          details: { sourceRow: r, unknownValue: code },
        };
      }
      if (!platforms.includes(code)) platforms.push(code);
    }
    if (platforms.length === 0) {
      return {
        ok: false,
        error: `Row ${r}: target_platforms is empty after parsing.`,
        details: { sourceRow: r },
      };
    }

    // ── style_hint (optional) ──
    let styleHint: StyleHint | undefined;
    if ("style_hint" in columnIndex) {
      const raw = readString(row, columnIndex.style_hint);
      if (raw) {
        const v = raw.trim().toLowerCase();
        if (!STYLE_HINT_VALUES.includes(v as StyleHint)) {
          return {
            ok: false,
            error: `Row ${r}: unknown style_hint "${raw}". Known: ${STYLE_HINT_VALUES.join(", ")}`,
            details: { sourceRow: r, unknownValue: raw },
          };
        }
        styleHint = v as StyleHint;
      }
    }

    // ── composition_hint (optional) ──
    let compositionHint: CompositionHint | undefined;
    if ("composition_hint" in columnIndex) {
      const raw = readString(row, columnIndex.composition_hint);
      if (raw) {
        const v = raw.trim().toLowerCase();
        if (!COMPOSITION_HINT_VALUES.includes(v as CompositionHint)) {
          return {
            ok: false,
            error: `Row ${r}: unknown composition_hint "${raw}". Known: ${COMPOSITION_HINT_VALUES.join(", ")}`,
            details: { sourceRow: r, unknownValue: raw },
          };
        }
        compositionHint = v as CompositionHint;
      }
    }

    // ── publish_date (optional) ──
    let publishDate: string | undefined;
    if ("publish_date" in columnIndex) {
      const cell = row.getCell(columnIndex.publish_date);
      const raw = readDate(cell);
      if (raw) {
        if (!DATE_RE.test(raw)) {
          return {
            ok: false,
            error: `Row ${r}: publish_date "${raw}" is not a valid YYYY-MM-DD.`,
            details: { sourceRow: r, unknownValue: raw },
          };
        }
        // Tighter check: month/day in range
        const [, mm, dd] = raw.split("-").map((n) => parseInt(n, 10));
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
          return {
            ok: false,
            error: `Row ${r}: publish_date "${raw}" is not a real calendar date.`,
            details: { sourceRow: r, unknownValue: raw },
          };
        }
        publishDate = raw;
      }
    }

    // ── notes (optional) ──
    let notes: string | undefined;
    if ("notes" in columnIndex) {
      const raw = readString(row, columnIndex.notes);
      if (raw) notes = raw;
    }

    posts.push({
      sourceRow: r,
      post_topic: postTopic!,
      headline_text: headline!,
      body_text: body!,
      target_platforms: platforms,
      ...(styleHint && { style_hint: styleHint }),
      ...(compositionHint && { composition_hint: compositionHint }),
      ...(publishDate && { publish_date: publishDate }),
      ...(notes && { notes }),
    });
  }

  if (posts.length === 0) {
    return { ok: false, error: "XLSX contains no data rows after the header." };
  }

  return { ok: true, posts, warnings };
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Rich text { richText: [{ text }] }
  if (typeof v === "object" && "richText" in v && Array.isArray((v as { richText: Array<{ text: string }> }).richText)) {
    return (v as { richText: Array<{ text: string }> }).richText.map((rt) => rt.text).join("");
  }
  // Formula result { formula, result }
  if (typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    return r === null || r === undefined ? "" : String(r);
  }
  // Hyperlink { text, hyperlink }
  if (typeof v === "object" && "text" in v) {
    return String((v as { text: unknown }).text ?? "");
  }
  // Dates fall through to here in some cases
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function readString(row: ExcelJS.Row, col: number | undefined): string | undefined {
  if (!col) return undefined;
  const raw = cellString(row.getCell(col));
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readDate(cell: ExcelJS.Cell): string | undefined {
  const v = cell.value;
  if (v instanceof Date) {
    // ISO date portion. exceljs treats Excel date cells as JS Date.
    return v.toISOString().slice(0, 10);
  }
  const s = cellString(cell).trim();
  return s.length > 0 ? s : undefined;
}

function rowIsBlank(row: ExcelJS.Row, columnIndex: Record<string, number>): boolean {
  for (const colNum of Object.values(columnIndex)) {
    const cell = row.getCell(colNum);
    if (cellString(cell).trim().length > 0) return false;
  }
  return true;
}
