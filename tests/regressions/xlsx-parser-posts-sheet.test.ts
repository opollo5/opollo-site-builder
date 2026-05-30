import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// ---------------------------------------------------------------------------
// REGRESSION: xlsx parser correctly reads the canonical mass-image-gen template.
//
// The template at docs/briefs/image-generator/mass-image-gen-template.xlsx has:
//   Sheet "Posts":  row 1 = title, row 2 = description, row 3 = headers (with
//                   " *" required-field markers), row 4+ = example data rows.
//   Sheets "Instructions" and "Reference" should be ignored.
//
// This test was added after the launch-blocker where the parser read row 1
// (the display title) as headers and rejected the template with "XLSX is
// missing required column(s): post_topic, headline_text, body_text,
// target_platforms".
// ---------------------------------------------------------------------------

const TEMPLATE_PATH = join(process.cwd(), "docs", "briefs", "image-generator", "mass-image-gen-template.xlsx");
const PUBLIC_PATH   = join(process.cwd(), "public", "templates", "mass-image-gen-template.xlsx");

describe("REGRESSION: xlsx parser + canonical template (Posts sheet, row 3 headers)", () => {
  it("parses the canonical template without error", async () => {
    const { parseXlsxBuffer } = await import("@/lib/ingestion/xlsx-parse");
    const buf = readFileSync(TEMPLATE_PATH);
    const result = await parseXlsxBuffer(buf);
    expect(result.ok, result.ok ? "" : `Parser rejected template: ${(result as { error: string }).error}`).toBe(true);
    if (result.ok) {
      console.log("✓ Template parsed:", result.posts.length, "posts,", result.warnings.length, "warnings");
    }
  });

  it("extracts posts with clean column values (no * suffix in data)", async () => {
    const { parseXlsxBuffer } = await import("@/lib/ingestion/xlsx-parse");
    const buf = readFileSync(TEMPLATE_PATH);
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const post of result.posts) {
        expect(post.post_topic).not.toContain("*");
        expect(post.headline_text).not.toContain("*");
        expect(post.body_text).not.toContain("*");
        expect(post.target_platforms.length).toBeGreaterThan(0);
      }
      console.log("✓ No * suffix leaked into values; all required fields present");
    }
  });

  it("correctly reads example data from row 4 onwards (not preamble rows)", async () => {
    const { parseXlsxBuffer } = await import("@/lib/ingestion/xlsx-parse");
    const buf = readFileSync(TEMPLATE_PATH);
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The preamble rows (1=title, 2=desc, 3=headers) must not appear as data posts.
      const hasTitle = result.posts.some(p =>
        p.post_topic.toLowerCase().includes("mass image") ||
        p.headline_text.toLowerCase().includes("fill one row")
      );
      expect(hasTitle).toBe(false);
      console.log("✓ Preamble rows not treated as data; first post sourceRow ≥ 4:", result.posts[0]?.sourceRow);
    }
  });

  it("public/templates/mass-image-gen-template.xlsx is identical to the source", () => {
    const src = readFileSync(TEMPLATE_PATH);
    const pub = readFileSync(PUBLIC_PATH);
    expect(src.equals(pub)).toBe(true);
    console.log("✓ public/templates copy is byte-for-byte identical to docs/briefs source");
  });

  it("rejects a single-sheet xlsx still works (backwards compat)", async () => {
    const { parseXlsxBuffer } = await import("@/lib/ingestion/xlsx-parse");
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1"); // not named "Posts"
    ws.addRow(["post_topic","headline_text","body_text","target_platforms"]);
    ws.addRow(["Test topic","Test headline","Test body","linkedin"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);
    const result = await parseXlsxBuffer(buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.posts[0]?.post_topic).toBe("Test topic");
      console.log("✓ Single-sheet xlsx (no 'Posts' sheet) still parsed correctly from row 1");
    }
  });
});
