// ---------------------------------------------------------------------------
// M12-PDF — Binary brief decoder.
//
// Extracts UTF-8 text from PDF and Word (.docx) byte payloads. Both deps
// (pdf-parse, mammoth) are CJS-only and are loaded via dynamic import so
// webpack never tries to bundle their native assets.
//
// Returns { ok: true, text } on success, or { ok: false, code, detail }
// for clean-fail cases (scanned PDF, empty docx, parser error). Callers
// map the failure codes to DB update + API response envelopes.
//
// The optional _extractText parameters allow tests to inject a mock
// extractor without module-level vi.mock hoisting.
// ---------------------------------------------------------------------------

export type DecodeOk = { ok: true; text: string };
export type DecodeFail = { ok: false; code: "BRIEF_PARSE_FAILED"; detail: string };
export type DecodeResult = DecodeOk | DecodeFail;

export type PdfExtractor = (bytes: Uint8Array) => Promise<string>;
export type DocxExtractor = (bytes: Uint8Array) => Promise<string>;

async function defaultPdfExtractor(bytes: Uint8Array): Promise<string> {
  // pdf-parse v2 uses a class-based API. Dynamic import avoids bundling
  // the pdfjs-dist assets at build time.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  const result = await parser.getText();
  return result.text ?? "";
}

async function defaultDocxExtractor(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
  return result.value ?? "";
}

export async function decodePdf(
  bytes: Uint8Array,
  _extractor: PdfExtractor = defaultPdfExtractor,
): Promise<DecodeResult> {
  let text: string;
  try {
    text = await _extractor(bytes);
  } catch {
    return {
      ok: false,
      code: "BRIEF_PARSE_FAILED",
      detail: "PDF extraction failed — the file may be corrupted or password-protected.",
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      code: "BRIEF_PARSE_FAILED",
      detail:
        "PDF appears to be scanned or image-only — no text could be extracted. Convert to Markdown and upload again.",
    };
  }
  return { ok: true, text };
}

export async function decodeDocx(
  bytes: Uint8Array,
  _extractor: DocxExtractor = defaultDocxExtractor,
): Promise<DecodeResult> {
  let text: string;
  try {
    text = await _extractor(bytes);
  } catch {
    return {
      ok: false,
      code: "BRIEF_PARSE_FAILED",
      detail: "Word document extraction failed — the file may be corrupted.",
    };
  }
  if (!text.trim()) {
    return {
      ok: false,
      code: "BRIEF_PARSE_FAILED",
      detail:
        "Word document appears to be empty or contains only images. Add text content and upload again.",
    };
  }
  return { ok: true, text };
}
