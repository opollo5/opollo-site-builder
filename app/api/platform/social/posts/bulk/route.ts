import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  bulkCreatePostMasters,
  ROW_LIMIT,
} from "@/lib/platform/social/posts/bulk-create";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/platform/social/posts/bulk — S7 bulk CSV upload.
//
// Accepts multipart/form-data with fields:
//   company_id  — UUID
//   file        — CSV file (text/csv or .csv extension)
//
// CSV format (header row required):
//   master_text,link_url
//   "Post copy...","https://example.com"
//   "Copy only",
//   ,"https://example.com/link-only"
//
// Limits (BUILD.md defaults):
//   - 100 data rows per upload
//   - 3 uploads/hour/company (Upstash sliding window)
//
// Auth: create_post (editor+).
// Response: { ok, data: { created, errorCount, errors } }
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorJson("VALIDATION_FAILED", "Request must be multipart/form-data.", 400);
  }

  const companyId = (formData.get("company_id") as string | null)?.trim() ?? "";
  if (!UUID_RE.test(companyId)) {
    return errorJson("VALIDATION_FAILED", "company_id must be a valid UUID.", 400);
  }

  // Auth gate
  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  // Rate limit: 3 uploads/hour/company
  const rl = await checkRateLimit("csv_upload", `company:${companyId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  // File validation
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return errorJson("VALIDATION_FAILED", "file field is required (CSV).", 400);
  }

  const fileBlob = file as File;
  if (
    fileBlob.type !== "" &&
    fileBlob.type !== "text/csv" &&
    !fileBlob.name?.endsWith(".csv")
  ) {
    return errorJson(
      "VALIDATION_FAILED",
      "File must be a CSV (text/csv or .csv extension).",
      400,
    );
  }

  let text: string;
  try {
    text = await fileBlob.text();
  } catch {
    return errorJson("VALIDATION_FAILED", "Could not read file.", 400);
  }

  // Parse CSV
  let parseResult: { headers: string[]; rows: Array<Record<string, string>> };
  try {
    parseResult = parseCSV(text);
  } catch (err) {
    return errorJson(
      "VALIDATION_FAILED",
      `CSV parse error: ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }

  const { headers, rows } = parseResult;

  // Required columns (case-insensitive)
  const normalised = headers.map((h) => h.toLowerCase().trim());
  const textIdx = normalised.indexOf("master_text");
  const linkIdx = normalised.indexOf("link_url");
  if (textIdx === -1 && linkIdx === -1) {
    return errorJson(
      "VALIDATION_FAILED",
      "CSV must have at least a master_text or link_url column header.",
      400,
    );
  }

  if (rows.length === 0) {
    return errorJson("VALIDATION_FAILED", "CSV has no data rows.", 400);
  }

  if (rows.length > ROW_LIMIT) {
    return errorJson(
      "VALIDATION_FAILED",
      `Upload exceeds the ${ROW_LIMIT}-row limit (got ${rows.length} rows). Split into smaller files.`,
      400,
    );
  }

  // Map rows to bulk-create input
  const inputRows = rows.map((row) => ({
    masterText: textIdx !== -1 ? (row[headers[textIdx]!] ?? null) : null,
    linkUrl: linkIdx !== -1 ? (row[headers[linkIdx]!] ?? null) : null,
  }));

  logger.info("social.posts.bulk-upload.start", {
    companyId,
    rowCount: inputRows.length,
    userId: gate.userId,
  });

  const result = await bulkCreatePostMasters(
    companyId,
    inputRows,
    gate.userId,
  );

  logger.info("social.posts.bulk-upload.complete", {
    companyId,
    created: result.created.length,
    errors: result.errors.length,
    userId: gate.userId,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        created: result.created.length,
        errorCount: result.errors.length,
        errors: result.errors,
        posts: result.created,
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}

// ---------------------------------------------------------------------------
// Minimal RFC 4180-compliant CSV parser.
//
// Handles:
//   - Quoted fields (commas inside quotes are preserved)
//   - Escaped quotes ("")
//   - CRLF and LF line endings
//   - Empty fields
//
// Does NOT handle multi-line fields (embedded \n inside a quoted field).
// That edge case is acceptable for V1 — callers must use single-line values.
// ---------------------------------------------------------------------------

function parseCSV(
  text: string,
): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) throw new Error("File is empty.");

  const headers = parseCSVLine(lines[0]!);
  if (headers.length === 0) throw new Error("Header row is empty.");

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]!);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = fields[j] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma — push empty field
      if (fields.length > 0 && line[line.length - 1] === ",") {
        fields.push("");
      }
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i]!;
          i++;
        }
      }
      fields.push(field);
      // skip comma separator
      if (line[i] === ",") i++;
    } else {
      // Unquoted field
      let field = "";
      while (i < line.length && line[i] !== ",") {
        field += line[i]!;
        i++;
      }
      fields.push(field);
      if (line[i] === ",") i++;
    }
  }

  return fields;
}
