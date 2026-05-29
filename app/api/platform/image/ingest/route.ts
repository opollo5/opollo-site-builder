import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

import { parseXlsxBuffer, type PostRow } from "@/lib/ingestion/xlsx-parse";
import { parseDocxBuffer } from "@/lib/ingestion/docx-parse";
import { interpretPosts, type InterpretedPost } from "@/lib/ingestion/interpret";
import { dispatchImageBatch, type DispatchJobSpec } from "@/lib/image/dispatch";
import { MASS_GEN_PLATFORM_MAP, type AspectRatio } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// POST /api/platform/image/ingest
//
// §C4 of MASS_IMAGE_GEN_BUILD_BRIEF. End-to-end mass-image-gen ingestion:
//   upload .xlsx or .docx → parse → AI interpret → fan-out into per-ratio
//   image jobs → dispatch batch → return batchId.
//
// Multipart body:
//   - company_id (uuid)
//   - file       (.xlsx or .docx, ≤ 5 MB)
//
// Query:
//   - mode=preview|generate  (default 'generate'; preview routes to B5)
//
// Caps (per brief §C4):
//   - 5 MB file size
//   - 100 parsed-row cap
//   - 5/hour/company rate limit (reuses csv_upload limiter)
//
// Returns the batchId so the operator can poll
// /api/platform/image/batch/[id] for completion.
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

function detectFormat(file: File): FileFormat | null {
  // Trust mime type when explicit; fall back to extension.
  if (file.type === XLSX_MIME) return "xlsx";
  if (file.type === DOCX_MIME) return "docx";
  const name = file.name?.toLowerCase() ?? "";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".docx")) return "docx";
  return null;
}

function parseMode(req: NextRequest): "preview" | "generate" {
  const v = new URL(req.url).searchParams.get("mode");
  return v === "preview" ? "preview" : "generate";
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
  // Reuses csv_upload (3/hour) for v1; can split into a dedicated limiter
  // if image-gen ingestion volume warrants its own bucket later.
  const rl = await checkRateLimit("csv_upload", `company:${companyId}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  // ─── Parse ──────────────────────────────────────────────────────────────
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

  // ─── Interpret (Anthropic) ─────────────────────────────────────────────
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

  // ─── Fan-out into per-ratio jobs (§1.7) ─────────────────────────────────
  // Build the source-row → publish_date lookup from the parser output;
  // interpretPosts strips it from InterpretedPost shape.
  const publishDateBySourceRow = new Map<number, string>();
  for (const row of parsed.posts) {
    if (row.publish_date) publishDateBySourceRow.set(row.sourceRow, row.publish_date);
  }
  const jobSpecs = fanOutJobs(interpreted.posts, publishDateBySourceRow);

  // ─── Dispatch ───────────────────────────────────────────────────────────
  const mode = parseMode(req);
  const dispatched = await dispatchImageBatch({
    companyId,
    triggeredBy: gate.userId,
    jobs: jobSpecs,
    mode,
    sourceFilename: fileBlob.name,
    sourceRowCount: interpreted.posts.length,
  });

  if (!dispatched.ok) {
    if (dispatched.code === "BUDGET_EXCEEDED") {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: dispatched.code,
            message: dispatched.message,
            ...dispatched.details,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 402 },
      );
    }
    return internalError(dispatched.message);
  }

  logger.info("image.ingest.ok", {
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

/**
 * Fan a post out into one job per distinct aspect ratio (§1.7). Each job
 * carries the `parentPostIndex` so D2's UI can group results back to their
 * source post, the post's `target_platforms` for B4's auto-attach, and the
 * post's optional `publish_date` looked up from the parsed source row.
 *
 * Exported for unit testing.
 */
export function fanOutJobs(
  posts: InterpretedPost[],
  publishDateBySourceRow: Map<number, string> = new Map(),
): DispatchJobSpec[] {
  const out: DispatchJobSpec[] = [];
  posts.forEach((post, postIndex) => {
    const ratios = uniqueRatiosForPlatforms(post.image_brief.target_platforms);
    const publishDate = publishDateBySourceRow.get(post.sourceRow);
    for (const aspectRatio of ratios) {
      out.push({
        styleId: post.image_brief.style_id,
        primaryColour: post.image_brief.primary_colour,
        compositionType: post.image_brief.composition_type,
        aspectRatio,
        targetPlatforms: platformsForRatio(post.image_brief.target_platforms, aspectRatio),
        ...(publishDate && { targetPublishDate: publishDate }),
        parentPostIndex: postIndex,
      });
    }
  });
  return out;
}

function uniqueRatiosForPlatforms(platforms: string[]): AspectRatio[] {
  const seen = new Set<AspectRatio>();
  const out: AspectRatio[] = [];
  for (const p of platforms) {
    const r = MASS_GEN_PLATFORM_MAP[p];
    if (!r || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

function platformsForRatio(platforms: string[], ratio: AspectRatio): string[] {
  return platforms.filter((p) => MASS_GEN_PLATFORM_MAP[p] === ratio);
}
