import { NextResponse, type NextRequest } from "next/server";

import { validationError } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  bulkCreatePostMasters,
  ROW_LIMIT,
} from "@/lib/platform/social/posts/bulk-create";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// POST /api/platform/social/posts/bulk — S7 bulk CSV upload.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return validationError("Request must be multipart/form-data.");
  }

  const companyId = (formData.get("company_id") as string | null)?.trim() ?? "";
  if (!UUID_RE.test(companyId)) {
    return validationError("company_id must be a valid UUID.");
  }

  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("csv_upload", `company:${companyId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return validationError("file field is required (CSV).");
  }

  const fileBlob = file as File;
  if (
    fileBlob.type !== "" &&
    fileBlob.type !== "text/csv" &&
    !fileBlob.name?.endsWith(".csv")
  ) {
    return validationError("File must be a CSV (text/csv or .csv extension).");
  }

  let text: string;
  try {
    text = await fileBlob.text();
  } catch {
    return validationError("Could not read file.");
  }

  let parseResult: { headers: string[]; rows: Array<Record<string, string>> };
  try {
    parseResult = parseCSV(text);
  } catch (err) {
    return validationError(
      `CSV parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { headers, rows } = parseResult;

  const normalised = headers.map((h) => h.toLowerCase().trim());
  const textIdx = normalised.indexOf("master_text");
  const linkIdx = normalised.indexOf("link_url");
  if (textIdx === -1 && linkIdx === -1) {
    return validationError(
      "CSV must have at least a master_text or link_url column header.",
    );
  }

  if (rows.length === 0) {
    return validationError("CSV has no data rows.");
  }

  if (rows.length > ROW_LIMIT) {
    return validationError(
      `Upload exceeds the ${ROW_LIMIT}-row limit (got ${rows.length} rows). Split into smaller files.`,
    );
  }

  const inputRows = rows.map((row) => ({
    masterText: textIdx !== -1 ? (row[headers[textIdx]!] ?? null) : null,
    linkUrl: linkIdx !== -1 ? (row[headers[linkIdx]!] ?? null) : null,
  }));

  logger.info("social.posts.bulk-upload.start", {
    companyId,
    rowCount: inputRows.length,
    userId: gate.userId,
  });

  const result = await bulkCreatePostMasters(companyId, inputRows, gate.userId);

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
      if (fields.length > 0 && line[line.length - 1] === ",") {
        fields.push("");
      }
      break;
    }

    if (line[i] === '"') {
      let field = "";
      i++;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i]!;
          i++;
        }
      }
      fields.push(field);
      if (line[i] === ",") i++;
    } else {
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
