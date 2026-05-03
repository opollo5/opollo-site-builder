import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  BRIEF_ALLOWED_MIME_TYPES,
  BRIEF_MAX_BYTES,
  uploadBrief,
  type BriefMimeType,
} from "@/lib/briefs";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
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
//                      EITHER file OR paste_text is required.
//   paste_text       — UAT-smoke-1: raw markdown text from a textarea.
//                      When present (and non-empty), used in place of
//                      `file`. Treated as text/markdown.
//   site_id          — UUID string.
//   title            — optional operator-facing label.
//   content_type     — UAT-smoke-1: 'page' or 'post'. Defaults to 'page'
//                      if absent or unrecognised.
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
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("briefs_upload", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

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
  const pasteTextRaw = form.get("paste_text");
  const contentTypeRaw = form.get("content_type");
  const clientIdempotencyKeyRaw = form.get("idempotency_key");

  if (typeof siteId !== "string" || !UUID_RE.test(siteId)) {
    return validationError("site_id must be a UUID.");
  }

  // Resolve content_type: explicit 'post' or default to 'page'. Anything
  // else (including absent / blank / unrecognised) lands as 'page'.
  const contentType: "page" | "post" =
    typeof contentTypeRaw === "string" && contentTypeRaw === "post"
      ? "post"
      : "page";

  // Source resolution: paste_text wins if non-empty, else file.
  const hasPaste =
    typeof pasteTextRaw === "string" && pasteTextRaw.trim().length > 0;
  const hasFile = file instanceof File && file.size > 0;
  if (!hasPaste && !hasFile) {
    return validationError(
      "Provide either a 'file' (multipart) or non-empty 'paste_text' field.",
    );
  }

  let bytes: Uint8Array;
  let mimeType: BriefMimeType;
  let sourceLabel: string;
  if (hasPaste) {
    const text = pasteTextRaw as string;
    bytes = new TextEncoder().encode(text);
    mimeType = "text/markdown" as BriefMimeType;
    sourceLabel = "Pasted brief";
  } else {
    const f = file as File;
    if (f.size > BRIEF_MAX_BYTES) {
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
    const detected = (f.type || "text/plain") as BriefMimeType;
    if (!BRIEF_ALLOWED_MIME_TYPES.includes(detected)) {
      const body: ApiResponse<never> = {
        ok: false,
        error: {
          code: "BRIEF_UNSUPPORTED_TYPE",
          message: `Unsupported MIME type: ${f.type || "unknown"}.`,
          retryable: false,
          suggested_action: "Upload a text/plain or text/markdown file.",
        },
        timestamp: new Date().toISOString(),
      };
      return NextResponse.json(body, { status: 415 });
    }
    bytes = new Uint8Array(await f.arrayBuffer());
    mimeType = detected;
    sourceLabel = f.name.replace(/\.[^.]+$/, "");
  }

  // Size guard for both file and paste paths (file path is checked
  // again above for the structured 413; paste path lands here).
  if (bytes.byteLength === 0) {
    const body: ApiResponse<never> = {
      ok: false,
      error: {
        code: "BRIEF_EMPTY",
        message: "Brief content is empty.",
        retryable: false,
        suggested_action: "Provide a non-empty file or paste content.",
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 400 });
  }
  if (bytes.byteLength > BRIEF_MAX_BYTES) {
    const body: ApiResponse<never> = {
      ok: false,
      error: {
        code: "BRIEF_TOO_LARGE",
        message: `Brief exceeds the ${BRIEF_MAX_BYTES}-byte cap.`,
        retryable: false,
        suggested_action: "Trim the brief and try again.",
      },
      timestamp: new Date().toISOString(),
    };
    return NextResponse.json(body, { status: 413 });
  }

  const defaultTitle =
    typeof titleRaw === "string" && titleRaw.trim().length > 0
      ? titleRaw.trim()
      : sourceLabel;

  let clientIdempotencyKey: string | undefined;
  if (typeof clientIdempotencyKeyRaw === "string" && clientIdempotencyKeyRaw.trim().length > 0) {
    const trimmed = clientIdempotencyKeyRaw.trim();
    if (trimmed.length > 100) {
      return validationError("idempotency_key must be ≤ 100 characters.");
    }
    clientIdempotencyKey = trimmed;
  }

  const result = await uploadBrief({
    siteId,
    title: defaultTitle,
    bytes,
    mimeType,
    uploadedBy: gate.user?.id ?? null,
    clientIdempotencyKey,
    contentType,
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
