import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

import { parseXlsxBuffer, type PostRow } from "@/lib/ingestion/xlsx-parse";
import { parseDocxBuffer } from "@/lib/ingestion/docx-parse";
import { parseXlsxRawRows } from "@/lib/ingestion/xlsx-raw-parse";
import { interpretPosts } from "@/lib/ingestion/interpret";
import { dispatchImageBatch } from "@/lib/image/dispatch";
import { fanOutJobs } from "@/lib/image/fan-out";
import { get_template_by_id } from "@/lib/image/templates";
import { mapFieldsToColumns, rowToModifications, validateMapping } from "@/lib/image/template-field-mapper";
import { PRICE_CENTS_PER_JOB } from "@/lib/image/budget";
import type { TemplateJobSpec } from "@/lib/image/template-bulk-types";
import type { TemplateField, Layer } from "@/lib/image/template-model";
import { TEMPLATE_SCHEMA_VERSION } from "@/lib/image/template-model";

// ---------------------------------------------------------------------------
// POST /api/platform/image/ingest
//
// §C4 of MASS_IMAGE_GEN_BUILD_BRIEF. End-to-end mass-image-gen ingestion.
//
// Multipart body:
//   - company_id  (uuid)
//   - file        (.xlsx or .docx, ≤ 5 MB)
//   - ingest_mode "ideogram" | "template"  (default "ideogram")
//   - template_id uuid  (required when ingest_mode=template)
//
// Query:
//   - mode=preview|generate  (default 'generate')
//
// Caps:
//   - 5 MB file size
//   - 100 parsed-row cap
//   - 5/hour/company rate limit (csv_upload bucket)
//
// ingest_mode=ideogram (default):
//   xlsx/docx → parse → AI interpret → fan-out → dispatch → { batchId }
//
// ingest_mode=template (Stream B Phase 2):
//   xlsx → parse raw rows → column-map to template fields → fan-out per
//   variant → dispatch → { batchId, mappingSummary, estimatedCostCents }
//   XLSX only; DOCX not supported for template mode.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_ROWS = 100;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type FileFormat = "xlsx" | "docx";
type IngestMode = "ideogram" | "template";

function detectFormat(file: File): FileFormat | null {
  if (file.type === XLSX_MIME) return "xlsx";
  if (file.type === DOCX_MIME) return "docx";
  const name = file.name?.toLowerCase() ?? "";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".docx")) return "docx";
  return null;
}

function parseGenerateMode(req: NextRequest): "preview" | "generate" {
  const v = new URL(req.url).searchParams.get("mode");
  return v === "preview" ? "preview" : "generate";
}

function parseIngestMode(formData: FormData): IngestMode {
  const v = (formData.get("ingest_mode") as string | null)?.trim();
  return v === "template" ? "template" : "ideogram";
}

function parseDestination(formData: FormData): "publish" | "download" {
  const v = (formData.get("destination") as string | null)?.trim();
  return v === "download" ? "download" : "publish";
}

/** Extract modifiable fields from a v2 template's layer list. */
function extractTemplateFields(layers: Layer[]): TemplateField[] {
  const fields: TemplateField[] = [];
  for (const layer of layers) {
    const l = layer as Layer;
    if (
      l.var &&
      typeof l.var.label === "string" &&
      l.var.label.trim().length > 0 &&
      (l.type === "text" || l.type === "image" || l.type === "rectangle")
    ) {
      fields.push({ name: l.name, type: l.type, var: l.var });
    }
  }
  return fields;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ─── Read multipart body ────────────────────────────────────────────────
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

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return validationError("file field is required (.xlsx or .docx).");
  }
  const fileBlob = file as File;

  if (fileBlob.size > MAX_FILE_BYTES) {
    return validationError(
      `File too large: ${fileBlob.size} bytes (max ${MAX_FILE_BYTES}).`,
    );
  }

  const format = detectFormat(fileBlob);
  if (!format) {
    return validationError(
      "File must be .xlsx or .docx (matched by mime type or extension).",
    );
  }

  // ─── Auth ───────────────────────────────────────────────────────────────
  const gate = await requireCanDoForApi(companyId, "create_post");
  if (gate.kind === "deny") return gate.response;

  // ─── Rate-limit (5/hour/company) ────────────────────────────────────────
  const rl = await checkRateLimit("csv_upload", `company:${companyId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  // ─── Route by ingest mode ────────────────────────────────────────────────
  const ingestMode = parseIngestMode(formData);
  const destination = parseDestination(formData);

  if (ingestMode === "template") {
    return handleTemplateIngest({ formData, fileBlob, format, companyId, gate, req, destination });
  }

  return handleIdeogramIngest({ fileBlob, format, companyId, gate, req, destination });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ideogram ingest (existing flow — unchanged)
// ─────────────────────────────────────────────────────────────────────────────

async function handleIdeogramIngest({
  fileBlob,
  format,
  companyId,
  gate,
  req,
  destination,
}: {
  fileBlob: File;
  format: FileFormat;
  companyId: string;
  gate: { userId: string };
  req: NextRequest;
  destination: "publish" | "download";
}): Promise<NextResponse> {
  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const parsed =
    format === "xlsx"
      ? await parseXlsxBuffer(buffer)
      : await parseDocxBuffer(buffer);

  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "PARSE_FAILED", message: parsed.error, details: parsed.details },
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  if (parsed.posts.length > MAX_ROWS) {
    return validationError(
      `Document has ${parsed.posts.length} posts; max ${MAX_ROWS} per upload.`,
    );
  }

  const interpreted = await interpretPosts({
    companyId,
    posts: parsed.posts as PostRow[],
  });

  if (!interpreted.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "INTERPRET_FAILED", message: interpreted.error, details: interpreted.details },
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  const publishDateBySourceRow = new Map<number, string>();
  for (const row of parsed.posts) {
    if (row.publish_date) publishDateBySourceRow.set(row.sourceRow, row.publish_date);
  }
  const jobSpecs = fanOutJobs(interpreted.posts, publishDateBySourceRow);

  // Build caption map: parentPostIndex (0-based) → AI-generated social copy.
  // fanOutJobs assigns parentPostIndex = the array index of the InterpretedPost,
  // which is the same as the index here. Multiple jobs per row (different aspect
  // ratios) share the same parentPostIndex and therefore the same caption.
  const postTextByParentIndex: Record<number, string> = {};
  interpreted.posts.forEach((p, i) => {
    if (p.post_text) postTextByParentIndex[i] = p.post_text;
  });

  const mode = parseGenerateMode(req);
  const dispatched = await dispatchImageBatch({
    companyId,
    triggeredBy: gate.userId,
    jobs: jobSpecs,
    mode,
    sourceFilename: fileBlob.name,
    sourceRowCount: interpreted.posts.length,
    postTextByParentIndex,
    destination,
  });

  if (!dispatched.ok) {
    if (dispatched.code === "BUDGET_EXCEEDED") {
      return NextResponse.json(
        {
          ok: false,
          error: { code: dispatched.code, message: dispatched.message, ...dispatched.details },
          timestamp: new Date().toISOString(),
        },
        { status: 402 },
      );
    }
    return internalError(dispatched.message);
  }

  logger.info("image.ingest.ideogram.ok", {
    companyId,
    format,
    mode,
    postCount: interpreted.posts.length,
    jobCount: jobSpecs.length,
    batchId: dispatched.batchId,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        batchId: dispatched.batchId,
        totalJobs: dispatched.totalJobs,
        postCount: interpreted.posts.length,
        mode: dispatched.mode,
        ...(dispatched.enqueueErrors && { enqueueErrors: dispatched.enqueueErrors }),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Template ingest — Stream B Phase 2
//
// Pipeline:
//   1. Validate: XLSX only + template_id required
//   2. Parse XLSX into generic header+row format (no Ideogram-specific validation)
//   3. Fetch template → extract fields + variants
//   4. Column-map fields to spreadsheet headers
//   5. Validate mapping (fail on unmatched required fields)
//   6. Fan-out: one TemplateJobSpec per (row × variant)
//   7. Dispatch via existing dispatchImageBatch()
//   8. Return pre-dispatch summary (must-have #3)
// ─────────────────────────────────────────────────────────────────────────────

async function handleTemplateIngest({
  formData,
  fileBlob,
  format,
  companyId,
  gate,
  req,
  destination,
}: {
  formData: FormData;
  fileBlob: File;
  format: FileFormat;
  companyId: string;
  gate: { userId: string };
  req: NextRequest;
  destination: "publish" | "download";
}): Promise<NextResponse> {
  // ─── 1. Validate template mode constraints ───────────────────────────────
  if (format !== "xlsx") {
    return validationError(
      "Template mode only supports .xlsx files. " +
      "DOCX ingestion is available for the Ideogram flow (omit ingest_mode=template).",
    );
  }

  const templateId = (formData.get("template_id") as string | null)?.trim() ?? "";
  if (!UUID_RE.test(templateId)) {
    return validationError("template_id must be a valid UUID (required for ingest_mode=template).");
  }

  // ─── 2. Parse XLSX into raw rows ────────────────────────────────────────
  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  const parsed = await parseXlsxRawRows(buffer);

  if (!parsed.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "PARSE_FAILED", message: parsed.error },
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  if (parsed.rowCount === 0) {
    return validationError("Spreadsheet has no data rows.");
  }

  if (parsed.rowCount > MAX_ROWS) {
    return validationError(
      `Spreadsheet has ${parsed.rowCount} rows; max ${MAX_ROWS} per upload.`,
    );
  }

  // ─── 3. Fetch template + extract fields + variants ───────────────────────
  const tmpl = await get_template_by_id(templateId, companyId);
  if (!tmpl) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "TEMPLATE_NOT_FOUND", message: `Template ${templateId} not found.` },
        timestamp: new Date().toISOString(),
      },
      { status: 404 },
    );
  }

  if (tmpl.schemaVersion !== TEMPLATE_SCHEMA_VERSION || !tmpl.resolvedTemplate) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "TEMPLATE_NOT_V2",
          message: "Template bulk generation requires a v2 (layer-based) template. " +
                   "Create or migrate your template in the template editor.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  const resolvedTemplate = tmpl.resolvedTemplate;
  const templateFields = extractTemplateFields(resolvedTemplate.layers as Layer[]);

  // Variant keys to render. Base canvas always included (undefined variantKey).
  // Named variants come from the template's variants array.
  const variantKeys: Array<string | undefined> = [undefined]; // base
  for (const v of resolvedTemplate.variants ?? []) {
    variantKeys.push(v.key);
  }

  // ─── 4. Column mapping ───────────────────────────────────────────────────
  const mapping = mapFieldsToColumns(templateFields, parsed.headers, parsed.rows[0]);

  // ─── 5. Validate mapping ─────────────────────────────────────────────────
  const validation = validateMapping(mapping);
  if (!validation.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "MAPPING_FAILED",
          message: validation.reason,
          unmatchedRequired: mapping.unmatched_required,
          availableColumns: parsed.headers,
          templateFields: templateFields.map((f) => ({
            name: f.name,
            label: f.var.label,
            required: f.var.required,
          })),
        },
        timestamp: new Date().toISOString(),
      },
      { status: 422 },
    );
  }

  // ─── 6. Fan-out: one TemplateJobSpec per (row × variant) ─────────────────
  const jobSpecs: TemplateJobSpec[] = [];

  for (let rowIdx = 0; rowIdx < parsed.rows.length; rowIdx++) {
    const row = parsed.rows[rowIdx];
    const modifications = rowToModifications(row, mapping);

    for (const variantKey of variantKeys) {
      jobSpecs.push({
        jobType: "template",
        templateId,
        variantKey,
        modifications,
        aspectRatio: resolvedTemplate.width === resolvedTemplate.height
          ? "1x1"
          : resolvedTemplate.width > resolvedTemplate.height
            ? "16x9"
            : "4x5",
        parentPostIndex: rowIdx,
      });
    }
  }

  // ─── 7. Dispatch ─────────────────────────────────────────────────────────
  const generateMode = parseGenerateMode(req);
  const dispatched = await dispatchImageBatch({
    companyId,
    triggeredBy: gate.userId,
    jobs: jobSpecs,
    mode: generateMode,
    destination,
    sourceFilename: fileBlob.name,
    sourceRowCount: parsed.rowCount,
  });

  if (!dispatched.ok) {
    if (dispatched.code === "BUDGET_EXCEEDED") {
      return NextResponse.json(
        {
          ok: false,
          error: { code: dispatched.code, message: dispatched.message, ...dispatched.details },
          timestamp: new Date().toISOString(),
        },
        { status: 402 },
      );
    }
    return internalError(dispatched.message);
  }

  // ─── 8. Pre-dispatch summary (must-have #3) ───────────────────────────────
  const matchedFields = mapping.fields.filter((f) => f.matchedColumn !== null).length;
  const unmatchedOptional = mapping.fields.filter(
    (f) => f.matchedColumn === null && !f.required,
  ).length;

  logger.info("image.ingest.template.ok", {
    companyId,
    templateId,
    rowCount: parsed.rowCount,
    variantCount: variantKeys.length,
    jobCount: jobSpecs.length,
    matchedFields,
    batchId: dispatched.batchId,
  });

  return NextResponse.json(
    {
      ok: true,
      data: {
        batchId: dispatched.batchId,
        totalJobs: dispatched.totalJobs,
        rowCount: parsed.rowCount,
        variantCount: variantKeys.length,
        estimatedCostCents: dispatched.totalJobs * PRICE_CENTS_PER_JOB,
        mode: dispatched.mode,
        mappingSummary: {
          matchedFields,
          unmatchedOptional,
          unusedColumns: mapping.unusedColumns,
        },
        ...(dispatched.enqueueErrors && { enqueueErrors: dispatched.enqueueErrors }),
      },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
