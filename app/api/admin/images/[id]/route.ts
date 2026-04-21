import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import {
  IMAGE_ALT_TEXT_MAX,
  IMAGE_CAPTION_MAX,
  IMAGE_TAG_MAX_LEN,
  IMAGE_TAGS_MAX_COUNT,
  updateImageMetadata,
} from "@/lib/image-library";
import { errorCodeToStatus } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// PATCH /api/admin/images/[id] — M5-3.
//
// Metadata edit endpoint. Admin + operator gated. Optimistic-locked on
// `image_library.version_lock` — the body carries the caller's
// `expected_version` and the UPDATE's WHERE clause pins it. Mismatch
// → 409 VERSION_CONFLICT with the current server-side version so the
// UI can render an actionable message.
//
// The patch object accepts any subset of {caption, alt_text, tags}:
//   - Unset keys are left alone.
//   - caption / alt_text may be null to clear.
//   - tags is always a full-array replace (no add/remove primitives).
//
// Trigger sync: the M4-1 BEFORE INSERT/UPDATE trigger on image_library
// refreshes `search_tsv` when caption or tags change, so no app-side
// reindex is needed — the search tool picks up edits on the next read.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TagSchema = z
  .string()
  .trim()
  .min(1)
  .max(IMAGE_TAG_MAX_LEN)
  .transform((t) => t.toLowerCase());

const PatchSchema = z
  .object({
    caption: z
      .string()
      .trim()
      .max(IMAGE_CAPTION_MAX)
      .nullable()
      .optional(),
    alt_text: z
      .string()
      .trim()
      .max(IMAGE_ALT_TEXT_MAX)
      .nullable()
      .optional(),
    tags: z.array(TagSchema).max(IMAGE_TAGS_MAX_COUNT).optional(),
  })
  .refine(
    (p) =>
      p.caption !== undefined ||
      p.alt_text !== undefined ||
      p.tags !== undefined,
    { message: "At least one of caption, alt_text, or tags must be provided." },
  );

const BodySchema = z.object({
  expected_version: z.number().int().min(1),
  patch: PatchSchema,
});

function errorJson(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false, ...(extra ?? {}) },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({
    roles: ["admin", "operator"] as const,
  });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return errorJson(
      "VALIDATION_FAILED",
      "Image id must be a UUID.",
      400,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Body failed validation.",
          details: { issues: parsed.error.issues },
          retryable: true,
        },
        timestamp: new Date().toISOString(),
      },
      { status: 400 },
    );
  }

  // Dedupe tags after normalization.
  const patch = parsed.data.patch;
  if (patch.tags) {
    patch.tags = Array.from(new Set(patch.tags));
  }

  const result = await updateImageMetadata(params.id, {
    expected_version: parsed.data.expected_version,
    updated_by: gate.user?.id ?? null,
    patch,
  });

  if (!result.ok) {
    const status = errorCodeToStatus(result.error.code);
    return NextResponse.json(
      { ...result, timestamp: result.timestamp },
      { status },
    );
  }

  // Bust the list + detail caches so the server-rendered surfaces
  // reflect the edit on the next render.
  revalidatePath("/admin/images");
  revalidatePath(`/admin/images/${params.id}`);

  return NextResponse.json(
    { ...result, timestamp: result.timestamp },
    { status: 200 },
  );
}
