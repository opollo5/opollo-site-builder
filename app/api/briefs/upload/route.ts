import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  BRIEF_ALLOWED_MIME_TYPES,
  BRIEF_MAX_BYTES,
  uploadBrief,
  type BriefMimeType,
} from "@/lib/briefs";
import { logger } from "@/lib/logger";
import {
  errorCodeToStatus,
  type ApiResponse,
} from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// M12-1 — POST /api/briefs/upload.
//
// multipart/form-data with fields:
//   file             — the brief document (text/plain | text/markdown; ≤ 10 MB).
//   site_id          — UUID string.
//   title            — optional operator-facing label.
//   idempotency_key  — optional client-supplied key.
//
// Returns the review URL on success. Parse runs synchronously in the
// request (see lib/briefs.ts).
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function respondErr<T>(result: ApiResponse<T>): NextResponse {
  if (result.ok) throw new Error("respondErr called with ok result");
  return NextResponse.json(result, { status: errorCodeToStatus(result.error.code) });
}

function validationError(message: string, details?: Record<string, unknown>): NextResponse {
  const body: ApiResponse<never> = {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      details,
      retryable: false,
      suggested_action: "Correct the listed fields and retry.",
    },
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: 400 });
}

export async function POST(req: Request): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["admin", "operator"] });
  if (gate.kind === "deny") return gate.response;

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    logger.error("briefs.upload.parse_form_failed", { error: err });
    return validationError("Request must be multipart/form-data.");
  }

  const siteId = form.get("site_id");
  const titleRaw = form.get("title");
  const file = form.get("file");
  const clientIdempotencyKeyRaw = form.get("idempotency_key");

  if (typeof siteId !== "string" || !UUID_RE.test(siteId)) {
    return validationError("site_id must be a UUID.");
  }
  if (!(file instanceof File)) {
    return validationError("Missing 'file' field; expected a File object.");
  }
  if (file.size === 0) {
    const body: ApiResponse<never> = {
      ok: false,
      error: {
        code: "BRIEF_EMPTY",
        message: "Brief file is empty.",
        retryable: false,
        suggested_action: "Upload a non-empty file and try again.",
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 400 });
  }
  if (file.size > BRIEF_MAX_BYTES) {
    const body: ApiResponse<never> = {
      ok: false,
      error: {
        code: "BRIEF_TOO_LARGE",
        message: `Brief exceeds the ${BRIEF_MAX_BYTES}-byte cap.`,
        retryable: false,
        suggested_action: "Upload a smaller file.",
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 413 });
  }

  const mimeType = (file.type || "text/plain") as BriefMimeType;
  if (!BRIEF_ALLOWED_MIME_TYPES.includes(mimeType)) {
    const body: ApiResponse<never> = {
      ok: false,
      error: {
        code: "BRIEF_UNSUPPORTED_TYPE",
        message: `Unsupported MIME type: ${file.type || "unknown"}.`,
        retryable: false,
        suggested_action: "Upload a text/plain or text/markdown file.",
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 415 });
  }

  const defaultTitle =
    typeof titleRaw === "string" && titleRaw.trim().length > 0
      ? titleRaw.trim()
      : file.name.replace(/\.[^.]+$/, "");

  let clientIdempotencyKey: string | undefined;
  if (typeof clientIdempotencyKeyRaw === "string" && clientIdempotencyKeyRaw.trim().length > 0) {
    const trimmed = clientIdempotencyKeyRaw.trim();
    if (trimmed.length > 100) {
      return validationError("idempotency_key must be ≤ 100 characters.");
    }
    clientIdempotencyKey = trimmed;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const result = await uploadBrief({
    siteId,
    title: defaultTitle,
    bytes,
    mimeType,
    uploadedBy: gate.user?.id ?? null,
    clientIdempotencyKey,
  });

  if (!result.ok) {
    logger.warn("briefs.upload.failed", {
      site_id: siteId,
      code: result.error.code,
    });
    return respondErr(result);
  }

  revalidatePath(`/admin/sites/${siteId}`);

  const status = result.data.replay ? 200 : 201;
  return NextResponse.json(result, { status });
}
