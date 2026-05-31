import "server-only";

import ExcelJS from "exceljs";
import { logger } from "@/lib/logger";
import type { SpreadsheetRow } from "@/lib/image/template-bulk-types";

// ---------------------------------------------------------------------------
// Generic XLSX row parser — Stream B template mode.
//
// Unlike parseXlsxBuffer (which validates against the canonical mass-image-gen
// template schema), this parser is format-agnostic: any XLSX file with a
// header row is accepted. Column names are taken verbatim from row 1; all
// cell values are coerced to strings. Empty rows (all blank cells) are
// skipped.
//
// Used by the /ingest endpoint when ingest_mode=template.
// ---------------------------------------------------------------------------

export interface XlsxRawParseResult {
  ok: true;
  headers: string[];
  rows: SpreadsheetRow[];
  rowCount: number;
}

export interface XlsxRawParseError {
  ok: false;
  error: string;
}

export type XlsxRawResult = XlsxRawParseResult | XlsxRawParseError;

const MAX_CELL_LENGTH = 2000;

/**
 * Parse an XLSX buffer into raw string rows keyed by column header.
 *
 * Assumptions:
 *  - Row 1 is the header row (no preamble rows; template XLSX files are
 *    operator-authored, not the canonical mass-image-gen template format).
 *  - Rows 2+ are data rows.
 *  - Empty rows (all blank) are skipped.
 *  - Duplicate header names: last column with that name wins.
 */
export async function parseXlsxRawRows(buffer: Buffer | ArrayBuffer): Promise<XlsxRawResult> {
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

  // ─── Header row ──────────────────────────────────────────────────────────
  const headerRow = ws.getRow(1);
  if (!headerRow || headerRow.cellCount === 0) {
    return { ok: false, error: "Sheet has no header row." };
  }

  const headers: string[] = [];
  // column index (1-based) → header name
  const colToHeader = new Map<number, string>();
  const lastCol = headerRow.cellCount;

  for (let c = 1; c <= lastCol; c++) {
    const raw = cellToString(headerRow.getCell(c));
    if (!raw) continue;
    headers.push(raw);
    colToHeader.set(c, raw);
  }

  if (headers.length === 0) {
    return { ok: false, error: "Sheet header row is empty." };
  }

  // ─── Data rows ───────────────────────────────────────────────────────────
  const rows: SpreadsheetRow[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header row

    const rec: SpreadsheetRow = {};
    let hasValue = false;

    for (const [col, header] of colToHeader) {
      const val = cellToString(row.getCell(col));
      rec[header] = val;
      if (val) hasValue = true;
    }

    if (hasValue) rows.push(rec);
  });

  logger.info("xlsx.raw.parsed", { sheetName: ws.name, headers: headers.length, rows: rows.length });

  return { ok: true, headers, rows, rowCount: rows.length };
}

function cellToString(cell: ExcelJS.Cell): string {
  if (cell.value === null || cell.value === undefined) return "";

  let raw: string;
  if (typeof cell.value === "object" && "result" in cell.value) {
    // Formula cell
    raw = String((cell.value as { result: unknown }).result ?? "");
  } else if (typeof cell.value === "object" && "richText" in cell.value) {
    // Rich text
    raw = (cell.value as { richText: Array<{ text?: string }> }).richText
      .map((r) => r.text ?? "")
      .join("");
  } else {
    raw = String(cell.value);
  }

  return raw.trim().slice(0, MAX_CELL_LENGTH);
}
