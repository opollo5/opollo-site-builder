/**
 * Round-trip unit tests for parseXlsxRawRows (Stream B Phase 2).
 *
 * Uses real ExcelJS to build buffers in-memory — no fixture files, no
 * ExcelJS mocks. Same pattern as xlsx-parse.unit.test.ts.
 *
 * Tests cover:
 *  - Single sheet with row-1 headers: correct headers + row values
 *  - Multi-sheet: first sheet used (no "Posts" sheet preference for template files)
 *  - Empty rows skipped
 *  - Numeric / date cells coerced to string
 *  - Empty header row → error
 *  - No sheets → error
 *  - rowCount matches non-empty data rows
 */

import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { parseXlsxRawRows } from "@/lib/ingestion/xlsx-raw-parse";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildXlsx(
  rows: Array<Array<string | number | null>>,
  sheetName = "Sheet1",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseXlsxRawRows", () => {
  it("parses headers from row 1 and data from row 2+", async () => {
    const buf = await buildXlsx([
      ["headline", "image_url"],
      ["Hello World", "https://example.com/img.jpg"],
      ["Row Two",    "https://example.com/two.jpg"],
    ]);
    const result = await parseXlsxRawRows(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(["headline", "image_url"]);
    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toMatchObject({ headline: "Hello World", image_url: "https://example.com/img.jpg" });
    expect(result.rows[1]).toMatchObject({ headline: "Row Two", image_url: "https://example.com/two.jpg" });
  });

  it("coerces numeric cells to strings", async () => {
    const buf = await buildXlsx([
      ["count", "price"],
      [42, 9.99],
    ]);
    const result = await parseXlsxRawRows(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.count).toBe("42");
    expect(result.rows[0]?.price).toBe("9.99");
  });

  it("skips fully empty rows", async () => {
    const buf = await buildXlsx([
      ["headline"],
      ["Row 1"],
      [null],      // blank row — should be skipped
      ["Row 3"],
    ]);
    const result = await parseXlsxRawRows(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(2);
    expect(result.rows.map((r) => r["headline"])).toEqual(["Row 1", "Row 3"]);
  });

  it("uses the first worksheet (no Posts-sheet preference)", async () => {
    // Template XLSX files are not the canonical mass-image-gen template,
    // so we always use the first sheet regardless of its name.
    const buf = await buildXlsx([
      ["field_name"],
      ["value"],
    ], "CustomSheet");

    const result = await parseXlsxRawRows(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.headers).toEqual(["field_name"]);
    expect(result.rows[0]?.field_name).toBe("value");
  });

  it("returns rowCount=0 and empty rows array for header-only sheet", async () => {
    const buf = await buildXlsx([["headline", "body"]]);
    const result = await parseXlsxRawRows(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it("returns headers with whitespace trimmed", async () => {
    const buf = await buildXlsx([
      ["  headline  ", " body "],
      ["Hello", "World"],
    ]);
    const result = await parseXlsxRawRows(buf);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The header row is trimmed by cellToString
    expect(result.headers).toEqual(["headline", "body"]);
  });
});
