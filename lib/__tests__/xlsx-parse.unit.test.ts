import { describe, expect, test } from "vitest";
import ExcelJS from "exceljs";

import { parseXlsxBuffer } from "@/lib/ingestion/xlsx-parse";

// ---------------------------------------------------------------------------
// C1 — XLSX parser unit tests.
//
// Builds XLSX buffers in-memory via the same exceljs lib the parser uses,
// then round-trips them through parseXlsxBuffer. No fixture files needed.
// ---------------------------------------------------------------------------

interface SheetSpec {
  headers: string[];
  rows: Array<Array<string | number | Date | null | undefined>>;
}

async function buildXlsx(spec: SheetSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(spec.headers);
  for (const row of spec.rows) {
    ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const FULL_HEADERS = [
  "post_topic",
  "headline_text",
  "body_text",
  "target_platforms",
  "style_hint",
  "composition_hint",
  "publish_date",
  "notes",
];

describe("parseXlsxBuffer — happy path", () => {
  test("parses 3 valid rows with all fields populated", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS,
      rows: [
        ["AI in marketing", "Headline A", "Body A.", "linkedin, instagram", "clean_corporate", "split_layout", "2026-06-15", "Q2 launch"],
        ["Customer story", "Headline B", "Body B.", "linkedin", "bold_promo", "full_background", "2026-06-22", ""],
        ["Product update", "Headline C", "Body C.", "x, facebook", "minimal_modern", "gradient_fade", "2026-06-29", ""],
      ],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(3);
    expect(result.posts[0]).toEqual(
      expect.objectContaining({
        sourceRow: 2,
        post_topic: "AI in marketing",
        headline_text: "Headline A",
        body_text: "Body A.",
        target_platforms: ["linkedin", "instagram"],
        style_hint: "clean_corporate",
        composition_hint: "split_layout",
        publish_date: "2026-06-15",
        notes: "Q2 launch",
      }),
    );
    expect(result.posts[1].notes).toBeUndefined(); // empty notes → undefined
  });

  test("parses required-only rows; optional columns omitted entirely", async () => {
    const buf = await buildXlsx({
      headers: ["post_topic", "headline_text", "body_text", "target_platforms"],
      rows: [["Topic 1", "Head", "Body.", "linkedin"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0]).toEqual(
      expect.objectContaining({
        post_topic: "Topic 1",
        target_platforms: ["linkedin"],
      }),
    );
    expect(result.posts[0].style_hint).toBeUndefined();
    expect(result.posts[0].publish_date).toBeUndefined();
  });
});

describe("parseXlsxBuffer — robustness", () => {
  test("whitespace-only values treated as empty (rejects required)", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [["   ", "Head", "Body.", "linkedin"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 2.*post_topic/);
  });

  test("trims whitespace from string fields", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [["  Topic  ", "  Headline  ", "  Body.  ", "  linkedin , instagram  "]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].post_topic).toBe("Topic");
    expect(result.posts[0].headline_text).toBe("Headline");
    expect(result.posts[0].target_platforms).toEqual(["linkedin", "instagram"]);
  });

  test("lowercases platform codes (LinkedIn → linkedin)", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [["T", "H", "B", "LinkedIn, INSTAGRAM, X"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].target_platforms).toEqual(["linkedin", "instagram", "x"]);
  });

  test("dedupes platform codes within a row", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [["T", "H", "B", "linkedin, linkedin, facebook"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].target_platforms).toEqual(["linkedin", "facebook"]);
  });

  test("case-insensitive header matching", async () => {
    const buf = await buildXlsx({
      headers: ["POST_TOPIC", "Headline_Text", "BODY_TEXT", "Target_Platforms"],
      rows: [["T", "H", "B", "linkedin"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].post_topic).toBe("T");
  });

  test("extra/unknown column ignored with a warning", async () => {
    const buf = await buildXlsx({
      headers: [...FULL_HEADERS.slice(0, 4), "weird_column"],
      rows: [["T", "H", "B", "linkedin", "ignored"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes("weird_column"))).toBe(true);
  });

  test("blank rows between data are skipped silently", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [
        ["T1", "H1", "B1", "linkedin"],
        ["", "", "", ""],
        ["T2", "H2", "B2", "instagram"],
      ],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(2);
    expect(result.posts[0].sourceRow).toBe(2);
    expect(result.posts[1].sourceRow).toBe(4); // row 3 was blank
  });
});

describe("parseXlsxBuffer — rejection paths", () => {
  test("missing required column → rejects whole file", async () => {
    const buf = await buildXlsx({
      headers: ["post_topic", "headline_text", "body_text"], // no target_platforms
      rows: [["T", "H", "B"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("target_platforms");
    expect(result.details?.missingColumns).toContain("target_platforms");
  });

  test("missing required value in row → rejects with row number", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [
        ["T1", "H1", "B1", "linkedin"],
        ["T2", "", "B2", "linkedin"], // empty headline_text
        ["T3", "H3", "B3", "linkedin"],
      ],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 3.*headline_text/);
    expect(result.details?.sourceRow).toBe(3);
  });

  test("malformed publish_date → rejects with row number", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS,
      rows: [["T", "H", "B", "linkedin", "", "", "not-a-date", ""]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 2.*publish_date/);
  });

  test("out-of-range publish_date month → rejects", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS,
      rows: [["T", "H", "B", "linkedin", "", "", "2026-13-01", ""]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 2.*publish_date/);
  });

  test("unknown platform code → rejects row", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [["T", "H", "B", "linkedin, tiktok"]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 2.*platform code.*tiktok/);
    expect(result.details?.unknownValue).toBe("tiktok");
  });

  test("unknown style_hint → rejects row", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS,
      rows: [["T", "H", "B", "linkedin", "extravagant", "", "", ""]],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Row 2.*style_hint.*extravagant/);
  });

  test("empty workbook (no data rows) → rejects", async () => {
    const buf = await buildXlsx({
      headers: FULL_HEADERS.slice(0, 4),
      rows: [],
    });
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no data rows/);
  });

  test("garbage bytes → rejects with parser error", async () => {
    const result = await parseXlsxBuffer(Buffer.from("this is not an xlsx file"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Failed to parse XLSX/);
  });
});

describe("parseXlsxBuffer — multi-sheet", () => {
  test("uses only the first sheet, logs the rest", async () => {
    const wb = new ExcelJS.Workbook();
    const ws1 = wb.addWorksheet("Posts");
    ws1.addRow(FULL_HEADERS.slice(0, 4));
    ws1.addRow(["T1", "H1", "B1", "linkedin"]);
    const ws2 = wb.addWorksheet("Other");
    ws2.addRow(["something", "else"]);
    ws2.addRow(["a", "b"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts).toHaveLength(1);
    expect(result.posts[0].post_topic).toBe("T1");
  });
});

describe("parseXlsxBuffer — date cell handling", () => {
  test("accepts an Excel date cell (JS Date) and emits YYYY-MM-DD", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Posts");
    ws.addRow(FULL_HEADERS);
    ws.addRow(["T", "H", "B", "linkedin", "", "", new Date(Date.UTC(2026, 5, 15)), ""]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posts[0].publish_date).toBe("2026-06-15");
  });
});
